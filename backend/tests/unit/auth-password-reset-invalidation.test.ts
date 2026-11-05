import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
  process.env.ROOT_ADMIN_USERNAME = 'admin';
  process.env.ROOT_ADMIN_PASSWORD = 'admin-password';
});

import { AppError } from '../../src/utils/errors';

/**
 * AuthService.resetPasswordWithToken must invalidate refresh sessions in the
 * same transaction as the password change (issue #2117), and must not touch
 * session state when the reset fails validation.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const USER_EMAIL = 'user@example.com';

const fakeDb = {
  users: new Map<string, { id: string; email: string; password: string; session_version: number }>(),
  sessionsRevoked: 0,
  statements: [] as string[],
};

async function fakeClientQuery(sql: string, params: unknown[] = []): Promise<unknown> {
  fakeDb.statements.push(sql);
  if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
    return { rows: [], rowCount: 0 };
  }
  if (sql.includes('SET password = $1')) {
    const user = [...fakeDb.users.values()].find((u) => u.email === params[1]);
    if (!user) {
      return { rows: [], rowCount: 0 };
    }
    user.password = params[0] as string;
    return { rows: [{ id: user.id }], rowCount: 1 };
  }
  if (sql.includes('SET session_version = session_version + 1')) {
    const user = fakeDb.users.get(params[0] as string);
    if (!user) {
      return { rows: [], rowCount: 0 };
    }
    user.session_version += 1;
    return { rows: [{ session_version: user.session_version }], rowCount: 1 };
  }
  if (sql.includes('SET revoked_at') && sql.includes('WHERE user_id')) {
    fakeDb.sessionsRevoked += 1;
    return { rows: [], rowCount: 1 };
  }
  throw new Error(`fakeClientQuery: unsupported SQL: ${sql}`);
}

const mocks = vi.hoisted(() => ({
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  verifyEmailOTPWithToken: vi.fn(),
  getAuthConfig: vi.fn(),
  oauthProvider: { getInstance: () => ({}) },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mocks.pool,
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: mocks.getAuthConfig,
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: {
    getInstance: () => ({
      verifyEmailOTPWithToken: mocks.verifyEmailOTPWithToken,
    }),
  },
  OTPPurpose: { RESET_PASSWORD: 'RESET_PASSWORD' },
  OTPType: { NUMERIC_CODE: 'NUMERIC_CODE', HASH_TOKEN: 'HASH_TOKEN' },
}));

vi.mock('../../src/services/email/email.service.js', () => ({
  EmailService: { getInstance: () => ({ sendWithTemplate: vi.fn() }) },
}));

vi.mock('../../src/services/email/smtp-config.service.js', () => ({
  SmtpConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: mocks.oauthProvider,
}));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: mocks.oauthProvider,
}));

import { AuthService } from '../../src/services/auth/auth.service';

describe('resetPasswordWithToken session invalidation (issue #2117)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeDb.users.clear();
    fakeDb.sessionsRevoked = 0;
    fakeDb.statements = [];
    fakeDb.users.set(USER_ID, {
      id: USER_ID,
      email: USER_EMAIL,
      password: 'old-hash',
      session_version: 3,
    });
    mocks.pool.connect.mockResolvedValue(mocks.client);
    mocks.client.query.mockImplementation(
      (sql: string, params: unknown[] = []) => fakeClientQuery(sql, params) as Promise<never>
    );
    mocks.getAuthConfig.mockResolvedValue({
      passwordMinLength: 8,
      requireNumber: true,
      requireLowercase: true,
      requireUppercase: true,
      requireSpecialChar: true,
    });
    mocks.verifyEmailOTPWithToken.mockResolvedValue({ email: USER_EMAIL });
  });

  it('bumps session_version and revokes sessions in the reset transaction', async () => {
    const authService = AuthService.getInstance();

    const result = await authService.resetPasswordWithToken('NewPass123!', 'reset-token');

    expect(result.message).toContain('Password reset successfully');
    const user = fakeDb.users.get(USER_ID);
    expect(user!.password).not.toBe('old-hash');
    expect(user!.session_version).toBe(4);
    expect(fakeDb.sessionsRevoked).toBe(1);
    expect(mocks.verifyEmailOTPWithToken).toHaveBeenCalledOnce();

    const joined = fakeDb.statements.join('\n');
    expect(joined).toContain('SET password = $1');
    expect(joined).toContain('SET session_version = session_version + 1');
    expect(joined).toContain('SET revoked_at');
    expect(joined).toContain('COMMIT');
    expect(joined).not.toContain('ROLLBACK');
  });

  it('does not touch session state when the new password fails validation', async () => {
    const authService = AuthService.getInstance();

    await expect(authService.resetPasswordWithToken('short', 'reset-token')).rejects.toBeInstanceOf(
      AppError
    );

    expect(mocks.pool.connect).not.toHaveBeenCalled();
    expect(mocks.verifyEmailOTPWithToken).not.toHaveBeenCalled();
    expect(fakeDb.users.get(USER_ID)!.session_version).toBe(3);
    expect(fakeDb.sessionsRevoked).toBe(0);
  });
});
