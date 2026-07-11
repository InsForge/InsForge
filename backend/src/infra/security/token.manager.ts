import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, type TokenPayloadSchema } from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '../../utils/next-actions.js';
import { appConfig } from '@/infra/config/app.config.js';

const JWT_SECRET = appConfig.app.jwtSecret;
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

export type RefreshSessionType = 'user' | 'admin';

/**
 * Refresh token payload interface
 */
export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iss: string;
  csrfNonce: string;
  sessionType: RefreshSessionType;
}

export interface RefreshTokenWithCsrf {
  refreshToken: string;
  csrfToken: string;
}

/**
 * Create JWKS instance with caching and timeout configuration
 * The instance will automatically cache keys and handle refetching
 */
const cloudApiHost = appConfig.cloud.apiHost;
const JWKS = createRemoteJWKSet(new URL(`${cloudApiHost}/.well-known/jwks.json`), {
  timeoutDuration: 10000, // 10 second timeout for HTTP requests
  cooldownDuration: 30000, // 30 seconds cooldown after successful fetch
  cacheMaxAge: 600000, // Maximum 10 minutes between refetches
});

/**
 * TokenManager - Handles JWT token operations
 * Infrastructure layer for token generation and verification
 */
export class TokenManager {
  private static instance: TokenManager;
  private privateKey: string | null = null;
  private publicKey: string | null = null;
  private kid: string | null = null;
  private isLoaded = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {
    if (!appConfig.app.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  public static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  /**
   * Preload JWT asymmetric keys from the database.
   */
  async ensureKeysLoaded(): Promise<void> {
    if (this.isLoaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      try {
        const { SecretService } = await import('../../services/secrets/secret.service.js');
        const secretService = SecretService.getInstance();
        const [priv, pub, kidVal] = await Promise.all([
          secretService.getSecretByKey('JWT_PRIVATE_KEY'),
          secretService.getSecretByKey('JWT_PUBLIC_KEY'),
          secretService.getSecretByKey('JWT_KEY_ID'),
        ]);

        if (priv && pub && kidVal) {
          this.privateKey = priv;
          this.publicKey = pub;
          this.kid = kidVal;
          this.isLoaded = true;
        } else {
          // If keys do not exist yet (e.g. very early startup), initialize them
          const keys = await secretService.initializeJwtKeyPair();
          this.privateKey = keys.privateKey;
          this.publicKey = keys.publicKey;
          this.kid = keys.kid;
          this.isLoaded = true;
        }
      } catch (error) {
        // Do not throw on startup if db isn't fully ready; fallback to HS256
        const log = await import('../../utils/logger.js');
        log.default.error('Failed to load JWT asymmetric keys in TokenManager', { error });
      }
    })().finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  /**
   * Export the public key as a JWK Set (JWKS).
   */
  async getJwks(): Promise<{ keys: Record<string, unknown>[] }> {
    await this.ensureKeysLoaded();
    if (!this.publicKey || !this.kid) {
      return { keys: [] };
    }

    try {
      const pubKeyObject = crypto.createPublicKey(this.publicKey);
      const jwk = pubKeyObject.export({ format: 'jwk' });
      return {
        keys: [
          {
            ...jwk,
            alg: 'RS256',
            use: 'sig',
            kid: this.kid,
          },
        ],
      };
    } catch (error) {
      const log = await import('../../utils/logger.js');
      log.default.error('Failed to export public key as JWK', { error });
      return { keys: [] };
    }
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(payload: TokenPayloadSchema): string {
    if (this.privateKey && this.kid) {
      return jwt.sign(payload, this.privateKey, {
        algorithm: 'RS256',
        keyid: this.kid,
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      });
    }
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  /**
   * Generate PostgREST user token (HS256)
   * Used for forwarding authenticated user requests to PostgREST
   */
  generatePostgrestUserToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m', // short-lived since it's only for this request forwarding
    });
  }

  /**
   * Generate PostgREST project admin token (never expires)
   * Used only for internal PostgREST proxy requests
   */
  generatePostgrestAdminToken(): string {
    const payload = {
      role: 'project_admin',
    };
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Generate refresh token for secure session management
   */
  generateRefreshToken(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce = this.generateCsrfNonce()
  ): string {
    const refreshPayload = this.createRefreshTokenPayload(userId, sessionType, csrfNonce);
    return jwt.sign(refreshPayload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  generateRefreshTokenWithCsrf(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce = this.generateCsrfNonce()
  ): RefreshTokenWithCsrf {
    const refreshPayload = this.createRefreshTokenPayload(userId, sessionType, csrfNonce);
    return {
      refreshToken: jwt.sign(refreshPayload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      }),
      csrfToken: this.generateCsrfToken(refreshPayload),
    };
  }

  /**
   * Verify refresh token and return payload
   * Ensures the token is a valid refresh token (not an access token)
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'insforge',
      }) as RefreshTokenPayload;

      // Ensure this is a refresh token, not an access token
      if (
        decoded.type !== 'refresh' ||
        !decoded.sub ||
        typeof decoded.csrfNonce !== 'string' ||
        decoded.csrfNonce.length === 0 ||
        (decoded.sessionType !== 'user' && decoded.sessionType !== 'admin')
      ) {
        throw new AppError('Invalid refresh token type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      return decoded;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * Generate PostgREST anon token (never expires)
   *
   * Internal use only: this token is minted at the gateway when a request
   * authenticates with the opaque anon key (`anon_...`) and is forwarded to
   * PostgREST, which derives the `anon` Postgres role from the `role` claim.
   * It must never be handed out to clients — clients use the opaque anon key,
   * which is rotatable/revocable (see SecretService).
   *
   * Like the PostgREST admin token, it carries no subject: anonymous requests
   * have a role, not an identity, so auth.uid() is NULL and identity-scoped
   * RLS policies fail closed. Legacy client-held anon JWTs (which carried a
   * fake subject) keep working through the normal JWT verification path.
   */
  generatePostgrestAnonToken(): string {
    const payload = {
      role: 'anon',
    };
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): TokenPayloadSchema {
    try {
      const decodedToken = jwt.decode(token, { complete: true });
      if (decodedToken && typeof decodedToken === 'object' && decodedToken.header) {
        const header = decodedToken.header;
        if (header.kid && header.alg === 'RS256' && this.publicKey && header.kid === this.kid) {
          const decoded = jwt.verify(token, this.publicKey, {
            algorithms: ['RS256'],
          }) as TokenPayloadSchema;
          if (!decoded.sub) {
            throw new AppError('Invalid token subject', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
          }
          return {
            sub: decoded.sub,
            email: decoded.email,
            role: decoded.role || 'authenticated',
          };
        }
      }

      // Fallback to HS256
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      }) as TokenPayloadSchema;
      if (!decoded.sub) {
        throw new AppError('Invalid token subject', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }
      return {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'authenticated',
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * Verify cloud backend JWT token
   * Validates JWT tokens from api.insforge.dev using JWKS
   */
  async verifyCloudToken(token: string): Promise<{ projectId: string; payload: JWTPayload }> {
    try {
      // JWKS handles caching internally, no need to manage it manually
      const { payload } = await jwtVerify(token, JWKS, {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      });

      // Verify project_id matches if configured
      const tokenProjectId = payload['projectId'] as string;
      const expectedProjectId = appConfig.cloud.projectId;

      if (expectedProjectId && tokenProjectId !== expectedProjectId) {
        throw new AppError(
          'Project ID mismatch',
          403,
          ERROR_CODES.AUTH_UNAUTHORIZED,
          NEXT_ACTIONS.CHECK_TOKEN
        );
      }

      return {
        projectId: tokenProjectId || expectedProjectId || 'local',
        payload,
      };
    } catch (error) {
      // Re-throw AppError as-is
      if (error instanceof AppError) {
        throw error;
      }

      // Wrap other JWT errors
      throw new AppError(
        `Invalid cloud authorization code: ${error instanceof Error ? error.message : 'Unknown error'}`,
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }
  }

  /**
   * Generate CSRF token derived from refresh-session claims using HMAC.
   */
  generateCsrfToken(payload: RefreshTokenPayload): string {
    return crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`insforge:csrf:v1:${payload.sessionType}:${payload.sub}:${payload.csrfNonce}`)
      .digest('hex');
  }

  /**
   * Verify CSRF token by re-computing from refresh-session claims.
   * Uses timing-safe comparison to prevent timing attacks
   */
  verifyCsrfToken(csrfHeader: string | undefined, payload: RefreshTokenPayload): boolean {
    if (!csrfHeader) {
      return false;
    }

    try {
      const expectedCsrf = this.generateCsrfToken(payload);
      return crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(expectedCsrf));
    } catch {
      return false;
    }
  }

  private generateCsrfNonce(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private createRefreshTokenPayload(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce: string
  ): RefreshTokenPayload {
    return {
      sub: userId,
      type: 'refresh',
      iss: 'insforge',
      csrfNonce,
      sessionType,
    };
  }
}
