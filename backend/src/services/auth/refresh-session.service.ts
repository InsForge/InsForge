import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  TokenManager,
  type RefreshSessionType,
  type RefreshTokenWithCsrf,
} from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * Server-side refresh-session tracking (fix for issue #2117).
 *
 * Refresh JWTs alone cannot be revoked, so every issued token also gets a row
 * in auth.refresh_sessions (keyed by the SHA-256 hash of the raw token - raw
 * tokens are never stored). Rotation atomically consumes the presented row
 * and inserts its successor, logout revokes the presented row, and password
 * reset bumps auth.users.session_version so older tokens fail validation.
 *
 * A consumed-token reuse returns 401 without cascading revocation: benign
 * concurrent clients sharing one token (e.g. two browser tabs) must observe a
 * transient 401 on the loser, not a full family logout.
 */
export interface IssuedRefreshSession extends RefreshTokenWithCsrf {
  jti: string;
  familyId: string;
  csrfNonce: string;
  expiresAt: Date;
}

export interface RotatedRefreshSession {
  subjectId: string;
  sessionType: RefreshSessionType;
  familyId: string;
  csrfNonce: string;
  refreshToken: string;
  csrfToken: string;
}

interface RefreshSessionRow {
  token_hash: string;
  family_id: string;
  user_id: string;
  session_type: RefreshSessionType;
  csrf_nonce: string;
  session_version: number;
  expires_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, mirrors the JWT exp

export class RefreshSessionService {
  private static instance: RefreshSessionService;
  private pool: Pool | null = null;
  private tokenManager: TokenManager;

  private constructor() {
    this.tokenManager = TokenManager.getInstance();
  }

  public static getInstance(): RefreshSessionService {
    if (!RefreshSessionService.instance) {
      RefreshSessionService.instance = new RefreshSessionService();
    }
    return RefreshSessionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Hash a raw refresh token for database lookup. The hash is one-way: a
   * leaked row cannot be exchanged for a session.
   */
  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mint a refresh token and persist its server-side record.
   *
   * Pass familyId + csrfNonce when creating a rotation successor to keep the
   * login's family and the web CSRF value stable; omit both for a fresh login
   * (new family, new CSRF lineage). When client is given, the INSERT joins
   * that transaction.
   */
  async issueRefreshSession(options: {
    subjectId: string;
    sessionType: RefreshSessionType;
    sessionVersion: number;
    familyId?: string;
    csrfNonce?: string;
    client?: PoolClient;
  }): Promise<IssuedRefreshSession> {
    const { subjectId, sessionType, sessionVersion, client } = options;
    const familyId = options.familyId ?? crypto.randomUUID();
    const csrfNonce = options.csrfNonce ?? crypto.randomBytes(32).toString('base64url');
    const jti = this.tokenManager.generateTokenId();

    const { refreshToken, csrfToken } = this.tokenManager.generateRefreshTokenWithCsrf(
      subjectId,
      sessionType,
      csrfNonce,
      jti,
      sessionVersion
    );
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const queryable = client ?? this.getPool();

    await queryable.query(
      `INSERT INTO auth.refresh_sessions
        (token_hash, family_id, user_id, session_type, csrf_nonce, session_version, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [this.hashToken(refreshToken), familyId, subjectId, sessionType, csrfNonce, sessionVersion, expiresAt]
    );

    return { refreshToken, csrfToken, jti, familyId, csrfNonce, expiresAt };
  }

  /**
   * Atomically consume a presented refresh token and mint its successor.
   *
   * The SELECT ... FOR UPDATE serializes concurrent refreshes with the same
   * token: exactly one request observes an active row; the others see it
   * consumed and receive 401. Tokens are returned only after COMMIT, so a
   * failed transaction never yields a usable token.
   */
  async rotateRefreshSession(
    presentedToken: string,
    expectedSessionType: RefreshSessionType
  ): Promise<RotatedRefreshSession> {
    const payload = this.tokenManager.verifyRefreshToken(presentedToken);
    if (payload.sessionType !== expectedSessionType) {
      throw new AppError('Invalid refresh session type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const presentedHash = this.hashToken(presentedToken);
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const record = await client.query<RefreshSessionRow>(
        `SELECT token_hash, family_id, user_id, session_type, csrf_nonce,
                session_version, expires_at, consumed_at, revoked_at
         FROM auth.refresh_sessions
         WHERE token_hash = $1
         FOR UPDATE`,
        [presentedHash]
      );
      const row = record.rows[0];
      if (!row || row.session_type !== expectedSessionType) {
        throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }
      if (row.consumed_at || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      // Bind the token to its owner and to the current session version.
      // Admin subjects have no auth.users row, so only user sessions are
      // version-checked here (admin invalidation happens per-session).
      let sessionVersion = payload.sessionVersion;
      if (expectedSessionType === 'user') {
        if (row.user_id !== payload.sub) {
          throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
        }
        const userResult = await client.query<{ id: string; session_version: number }>(
          `SELECT id, session_version FROM auth.users WHERE id = $1`,
          [payload.sub]
        );
        const dbUser = userResult.rows[0];
        if (!dbUser) {
          logger.warn('[Auth:Refresh] User not found for valid refresh token', {
            userId: payload.sub,
          });
          throw new AppError('User not found', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
        }
        if (dbUser.session_version !== payload.sessionVersion) {
          throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
        }
        sessionVersion = dbUser.session_version;
      }

      // Successor keeps the family and CSRF lineage so web multi-tab clients
      // sharing one cookie jar keep a valid CSRF value; single-use is enforced
      // by the consumed_at mark below, not by CSRF rotation.
      const successor = await this.issueRefreshSession({
        subjectId: payload.sub,
        sessionType: expectedSessionType,
        sessionVersion,
        familyId: row.family_id,
        csrfNonce: payload.csrfNonce,
        client,
      });

      await client.query(
        `UPDATE auth.refresh_sessions
         SET consumed_at = NOW(), replaced_by_hash = $1, updated_at = NOW()
         WHERE token_hash = $2`,
        [this.hashToken(successor.refreshToken), presentedHash]
      );

      await client.query('COMMIT');

      return {
        subjectId: payload.sub,
        sessionType: expectedSessionType,
        familyId: row.family_id,
        csrfNonce: payload.csrfNonce,
        refreshToken: successor.refreshToken,
        csrfToken: successor.csrfToken,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke the session behind a presented refresh token (logout).
   * Returns true when a live session was revoked; false for unknown,
   * already-consumed/revoked, expired, or malformed tokens. Never throws for
   * token-shape problems so logout stays idempotent.
   */
  async revokeRefreshSession(
    presentedToken: string,
    expectedSessionType?: RefreshSessionType
  ): Promise<boolean> {
    let payload;
    try {
      payload = this.tokenManager.verifyRefreshToken(presentedToken);
    } catch {
      return false;
    }
    if (expectedSessionType && payload.sessionType !== expectedSessionType) {
      return false;
    }

    const result = await this.getPool().query(
      `UPDATE auth.refresh_sessions
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [this.hashToken(presentedToken)]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Revoke every live session for a subject. Used with a session_version bump
   * on password reset; the version check alone already rejects older tokens,
   * this removes their rows' usability defence-in-depth within the same txn.
   */
  async revokeAllForSubject(subjectId: string, client: PoolClient): Promise<number> {
    const result = await client.query(
      `UPDATE auth.refresh_sessions
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
      [subjectId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Issue + persist a refresh session for a fresh login, resolving the
   * current session version automatically (0 for admin subjects and unknown
   * users). Rotation successors must use issueRefreshSession directly so the
   * family and CSRF lineage are preserved.
   */
  async issueSessionForSubject(
    subjectId: string,
    sessionType: RefreshSessionType
  ): Promise<IssuedRefreshSession> {
    const sessionVersion =
      sessionType === 'user' ? ((await this.getSessionVersion(subjectId)) ?? 0) : 0;
    return this.issueRefreshSession({ subjectId, sessionType, sessionVersion });
  }

  /**
   * Current session_version for a user, or null when the user does not exist.
   */
  async getSessionVersion(userId: string): Promise<number | null> {
    const result = await this.getPool().query<{ session_version: number }>(
      `SELECT session_version FROM auth.users WHERE id = $1`,
      [userId]
    );
    return result.rows[0] ? result.rows[0].session_version : null;
  }

  /**
   * Atomically increment a user's session version. Must run inside the
   * password-reset transaction so the password change and the invalidation
   * commit together; never call it when the reset fails.
   */
  async bumpSessionVersion(userId: string, client: PoolClient): Promise<number> {
    const result = await client.query<{ session_version: number }>(
      `UPDATE auth.users
       SET session_version = session_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING session_version`,
      [userId]
    );
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    return result.rows[0].session_version;
  }
}
