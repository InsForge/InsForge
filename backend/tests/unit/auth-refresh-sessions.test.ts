import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { TokenManager } from '../../src/infra/security/token.manager';
import { RefreshSessionService } from '../../src/services/auth/refresh-session.service';

/**
 * In-memory fake for the pg Pool/Client surface used by RefreshSessionService.
 * Supports only the statements the service issues; anything else throws so
 * new queries fail loudly here instead of silently passing.
 */

interface FakeSessionRow {
  token_hash: string;
  family_id: string;
  user_id: string;
  session_type: string;
  csrf_nonce: string;
  session_version: number;
  expires_at: Date;
  consumed_at: Date | null;
  revoked_at: Date | null;
  replaced_by_hash: string | null;
}

const store = {
  users: new Map<string, { id: string; session_version: number }>(),
  sessions: new Map<string, FakeSessionRow>(),
  selectsForUpdate: 0,
};

function toDbRow(row: FakeSessionRow): Record<string, unknown> {
  return {
    token_hash: row.token_hash,
    family_id: row.family_id,
    user_id: row.user_id,
    session_type: row.session_type,
    csrf_nonce: row.csrf_nonce,
    session_version: row.session_version,
    expires_at: row.expires_at.toISOString(),
    consumed_at: row.consumed_at ? row.consumed_at.toISOString() : null,
    revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
  };
}

async function fakeQuery(
  sql: string,
  params: unknown[] = []
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const text = sql;
  if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }
  if (text.includes('INSERT INTO auth.refresh_sessions')) {
    const [token_hash, family_id, user_id, session_type, csrf_nonce, session_version, expires_at] =
      params as [string, string, string, string, string, number, Date];
    store.sessions.set(token_hash, {
      token_hash,
      family_id,
      user_id,
      session_type,
      csrf_nonce,
      session_version,
      expires_at: new Date(expires_at),
      consumed_at: null,
      revoked_at: null,
      replaced_by_hash: null,
    });
    return { rows: [], rowCount: 1 };
  }
  if (text.includes('FROM auth.refresh_sessions') && text.includes('WHERE token_hash')) {
    if (text.includes('FOR UPDATE')) {
      store.selectsForUpdate += 1;
    }
    const row = store.sessions.get(params[0] as string);
    return { rows: row ? [toDbRow(row)] : [], rowCount: row ? 1 : 0 };
  }
  if (text.includes('SET consumed_at') && text.includes('WHERE token_hash')) {
    const row = store.sessions.get(params[1] as string);
    if (!row) {
      return { rows: [], rowCount: 0 };
    }
    row.consumed_at = new Date();
    row.replaced_by_hash = params[0] as string;
    return { rows: [], rowCount: 1 };
  }
  if (text.includes('SET revoked_at') && text.includes('WHERE token_hash')) {
    const row = store.sessions.get(params[0] as string);
    if (!row || row.revoked_at || row.consumed_at) {
      return { rows: [], rowCount: 0 };
    }
    row.revoked_at = new Date();
    return { rows: [], rowCount: 1 };
  }
  if (text.includes('SET revoked_at') && text.includes('WHERE user_id')) {
    let count = 0;
    for (const row of store.sessions.values()) {
      if (row.user_id === params[0] && !row.revoked_at && !row.consumed_at) {
        row.revoked_at = new Date();
        count += 1;
      }
    }
    return { rows: [], rowCount: count };
  }
  if (text.includes('SET session_version = session_version + 1')) {
    const user = store.users.get(params[0] as string);
    if (!user) {
      return { rows: [], rowCount: 0 };
    }
    user.session_version += 1;
    return { rows: [{ session_version: user.session_version }], rowCount: 1 };
  }
  if (text.includes('FROM auth.users WHERE id')) {
    const user = store.users.get(params[0] as string);
    if (!user) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes('SELECT session_version')) {
      return { rows: [{ session_version: user.session_version }], rowCount: 1 };
    }
    return { rows: [{ id: user.id, session_version: user.session_version }], rowCount: 1 };
  }
  throw new Error(`fakeQuery: unsupported SQL: ${text}`);
}

const fakeClient = {
  query: vi.fn((sql: string, params: unknown[] = []) => fakeQuery(sql, params)),
  release: vi.fn(),
};

const fakePool = {
  query: vi.fn((sql: string, params: unknown[] = []) => fakeQuery(sql, params)),
  connect: vi.fn(async () => fakeClient),
};

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => fakePool,
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';

function expectUnauthorized(promise: Promise<unknown>): Promise<AppError> {
  return promise.then(
    () => {
      throw new Error('expected 401 AppError but the call succeeded');
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(401);
      return error as AppError;
    }
  );
}

describe('RefreshSessionService - single-use rotation (issue #2117)', () => {
  let service: RefreshSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    store.users.clear();
    store.sessions.clear();
    store.selectsForUpdate = 0;
    store.users.set(USER_ID, { id: USER_ID, session_version: 0 });
    service = RefreshSessionService.getInstance();
  });

  it('issues a tracked session whose JWT carries jti and sessionVersion', async () => {
    const issued = await service.issueSessionForSubject(USER_ID, 'user');

    expect(issued.refreshToken).toBeTypeOf('string');
    expect(issued.csrfToken).toBeTypeOf('string');
    const payload = TokenManager.getInstance().verifyRefreshToken(issued.refreshToken);
    expect(payload.jti).toBe(issued.jti);
    expect(payload.sessionVersion).toBe(0);
    expect(store.sessions.has(service.hashToken(issued.refreshToken))).toBe(true);
    // Only the hash is stored - the raw token is not recoverable from the row.
    const row = store.sessions.get(service.hashToken(issued.refreshToken));
    expect(JSON.stringify(row)).not.toContain(issued.refreshToken);
  });

  it('rotates R1 -> R2 and rejects reuse of R1 with 401', async () => {
    const first = await service.issueSessionForSubject(USER_ID, 'user');

    const second = await service.rotateRefreshSession(first.refreshToken, 'user');
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.subjectId).toBe(USER_ID);
    // CSRF lineage is stable across rotation for multi-tab web clients.
    expect(second.csrfToken).toBe(first.csrfToken);

    const error = await expectUnauthorized(service.rotateRefreshSession(first.refreshToken, 'user'));
    expect(error.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);

    // The successor still works: R1 -> R2 -> R3, R1/R2 dead, R3 live.
    const third = await service.rotateRefreshSession(second.refreshToken, 'user');
    await expectUnauthorized(service.rotateRefreshSession(second.refreshToken, 'user'));
    const fourth = await service.rotateRefreshSession(third.refreshToken, 'user');
    expect(fourth.subjectId).toBe(USER_ID);
  });

  it('locks the session row during rotation so concurrent reuse cannot succeed twice', async () => {
    const first = await service.issueSessionForSubject(USER_ID, 'user');

    await service.rotateRefreshSession(first.refreshToken, 'user');

    // The consuming SELECT must take a row lock; without FOR UPDATE two
    // concurrent transactions could both observe an active row. True parallel
    // races require a live Postgres; this pins the locking read.
    expect(store.selectsForUpdate).toBeGreaterThan(0);

    // The loser of a race observes the consumed row and gets 401.
    await expectUnauthorized(service.rotateRefreshSession(first.refreshToken, 'user'));
  });

  it('rejects rotation of an unknown but well-formed token (legacy transition)', async () => {
    // Genuinely signed, correct shape, but never persisted (e.g. minted
    // before deployment). Must fail secure, not pass as valid.
    const orphan = TokenManager.getInstance().generateRefreshTokenWithCsrf(USER_ID, 'user', 'n', 'j', 0);

    await expectUnauthorized(service.rotateRefreshSession(orphan.refreshToken, 'user'));
  });

  it('rejects tokens whose session type does not match the endpoint', async () => {
    const userSession = await service.issueSessionForSubject(USER_ID, 'user');

    await expectUnauthorized(service.rotateRefreshSession(userSession.refreshToken, 'admin'));
    // The failed cross-type attempt must not consume the token.
    const rotated = await service.rotateRefreshSession(userSession.refreshToken, 'user');
    expect(rotated.subjectId).toBe(USER_ID);
  });

  it('rejects expired session records', async () => {
    const issued = await service.issueSessionForSubject(USER_ID, 'user');
    const row = store.sessions.get(service.hashToken(issued.refreshToken));
    row!.expires_at = new Date(Date.now() - 1000);

    await expectUnauthorized(service.rotateRefreshSession(issued.refreshToken, 'user'));
  });
});

describe('RefreshSessionService - logout revocation (issue #2117)', () => {
  let service: RefreshSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    store.users.clear();
    store.sessions.clear();
    store.users.set(USER_ID, { id: USER_ID, session_version: 0 });
    service = RefreshSessionService.getInstance();
  });

  it('revokes the presented session so it cannot refresh after logout', async () => {
    const issued = await service.issueSessionForSubject(USER_ID, 'user');

    expect(await service.revokeRefreshSession(issued.refreshToken, 'user')).toBe(true);
    await expectUnauthorized(service.rotateRefreshSession(issued.refreshToken, 'user'));
  });

  it('logout is per-session: revoking device A leaves device B working', async () => {
    const deviceA = await service.issueSessionForSubject(USER_ID, 'user');
    const deviceB = await service.issueSessionForSubject(USER_ID, 'user');
    expect(deviceA.refreshToken).not.toBe(deviceB.refreshToken);

    await service.revokeRefreshSession(deviceA.refreshToken, 'user');

    await expectUnauthorized(service.rotateRefreshSession(deviceA.refreshToken, 'user'));
    const rotatedB = await service.rotateRefreshSession(deviceB.refreshToken, 'user');
    expect(rotatedB.subjectId).toBe(USER_ID);
  });

  it('revoke is idempotent and safe for garbage input', async () => {
    const issued = await service.issueSessionForSubject(USER_ID, 'user');

    expect(await service.revokeRefreshSession(issued.refreshToken, 'user')).toBe(true);
    expect(await service.revokeRefreshSession(issued.refreshToken, 'user')).toBe(false);
    expect(await service.revokeRefreshSession('not-a-token')).toBe(false);
    expect(await service.revokeRefreshSession(issued.refreshToken, 'admin')).toBe(false);
  });

  it('tracks admin sessions with the same single-use guarantee', async () => {
    const admin = await service.issueSessionForSubject('local:admin', 'admin');

    const rotated = await service.rotateRefreshSession(admin.refreshToken, 'admin');
    expect(rotated.subjectId).toBe('local:admin');
    await expectUnauthorized(service.rotateRefreshSession(admin.refreshToken, 'admin'));

    expect(await service.revokeRefreshSession(rotated.refreshToken, 'admin')).toBe(true);
    await expectUnauthorized(service.rotateRefreshSession(rotated.refreshToken, 'admin'));
  });
});

describe('RefreshSessionService - password-reset invalidation (issue #2117)', () => {
  let service: RefreshSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    store.users.clear();
    store.sessions.clear();
    store.users.set(USER_ID, { id: USER_ID, session_version: 0 });
    service = RefreshSessionService.getInstance();
  });

  it('rejects pre-reset tokens after a version bump, accepts post-reset tokens', async () => {
    const before1 = await service.issueSessionForSubject(USER_ID, 'user');
    const before2 = await service.rotateRefreshSession(before1.refreshToken, 'user');

    // Simulate AuthService.resetPasswordWithToken's atomic step.
    const bumped = await fakeClient.query(
      'UPDATE auth.users SET session_version = session_version + 1',
      [USER_ID]
    );
    expect(bumped.rows[0].session_version).toBe(1);
    await service.revokeAllForSubject(USER_ID, fakeClient as never);

    await expectUnauthorized(service.rotateRefreshSession(before1.refreshToken, 'user'));
    await expectUnauthorized(service.rotateRefreshSession(before2.refreshToken, 'user'));

    const after = await service.issueSessionForSubject(USER_ID, 'user');
    expect(TokenManager.getInstance().verifyRefreshToken(after.refreshToken).sessionVersion).toBe(
      1
    );
    const rotated = await service.rotateRefreshSession(after.refreshToken, 'user');
    expect(rotated.subjectId).toBe(USER_ID);
  });

  it('revokeAllForSubject only touches live rows of that subject', async () => {
    const live = await service.issueSessionForSubject(USER_ID, 'user');
    const otherUser = '22222222-2222-4222-8222-222222222222';
    store.users.set(otherUser, { id: otherUser, session_version: 0 });
    const other = await service.issueSessionForSubject(otherUser, 'user');

    await service.revokeAllForSubject(USER_ID, fakeClient as never);

    await expectUnauthorized(service.rotateRefreshSession(live.refreshToken, 'user'));
    const rotated = await service.rotateRefreshSession(other.refreshToken, 'user');
    expect(rotated.subjectId).toBe(otherUser);
  });
});

describe('TokenManager - legacy rejection and access/refresh separation (issue #2117)', () => {
  const tokenManager = TokenManager.getInstance();

  it('rejects legacy refresh tokens without jti/sessionVersion', () => {
    const legacy = jwt.sign(
      {
        sub: USER_ID,
        type: 'refresh',
        iss: 'insforge',
        csrfNonce: 'nonce',
        sessionType: 'user',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' }
    );

    expect(() => tokenManager.verifyRefreshToken(legacy)).toThrow(AppError);
  });

  it('rejects refresh tokens with a non-numeric sessionVersion', () => {
    const malformed = jwt.sign(
      {
        sub: USER_ID,
        type: 'refresh',
        iss: 'insforge',
        csrfNonce: 'nonce',
        sessionType: 'user',
        jti: 'jti',
        sessionVersion: 'zero',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' }
    );

    expect(() => tokenManager.verifyRefreshToken(malformed)).toThrow(AppError);
  });

  it('rejects a refresh JWT presented as a bearer access token', async () => {
    store.users.clear();
    store.sessions.clear();
    store.users.set(USER_ID, { id: USER_ID, session_version: 0 });
    const service = RefreshSessionService.getInstance();
    const issued = await service.issueSessionForSubject(USER_ID, 'user');

    expect(() => tokenManager.verifyToken(issued.refreshToken)).toThrow(AppError);
  });

  it('still accepts real access tokens and rejects access tokens at refresh', () => {
    const accessToken = tokenManager.generateAccessToken({
      sub: USER_ID,
      email: 'user@example.com',
      role: 'authenticated',
    });

    expect(tokenManager.verifyToken(accessToken).sub).toBe(USER_ID);
    expect(() => tokenManager.verifyRefreshToken(accessToken)).toThrow(AppError);
  });
});
