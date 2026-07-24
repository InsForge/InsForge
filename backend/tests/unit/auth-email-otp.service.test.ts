import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ROOT_ADMIN_USERNAME = 'admin';
process.env.ROOT_ADMIN_PASSWORD = 'admin-password';

const mocks = vi.hoisted(() => ({
  pool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
  createEmailOTP: vi.fn(),
  attemptEmailOTPWithCode: vi.fn(),
  sendWithTemplate: vi.fn(),
  getAuthConfig: vi.fn(),
  generateAccessToken: vi.fn(),
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
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
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
      createEmailOTP: mocks.createEmailOTP,
      attemptEmailOTPWithCode: mocks.attemptEmailOTPWithCode,
    }),
  },
  OTPPurpose: {
    VERIFY_EMAIL: 'VERIFY_EMAIL',
    RESET_PASSWORD: 'RESET_PASSWORD',
    SIGN_IN: 'SIGN_IN',
  },
  OTPType: {
    NUMERIC_CODE: 'NUMERIC_CODE',
    HASH_TOKEN: 'HASH_TOKEN',
  },
}));

vi.mock('../../src/services/email/email.service.js', () => ({
  EmailService: {
    getInstance: () => ({
      sendWithTemplate: mocks.sendWithTemplate,
    }),
  },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: mocks.generateAccessToken,
    }),
  },
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

vi.mock('../../src/infra/config/app.config.js', () => {
  const appConfig = {
    app: { jwtSecret: 'test-secret', name: 'test' },
    cloud: { projectId: null },
    auth: { rootAdminUsername: 'admin', rootAdminPassword: 'admin-password' },
  };
  return { appConfig, config: appConfig };
});

import { AuthService } from '../../src/services/auth/auth.service.js';
import { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const AUTH_CONFIG = {
  disableSignup: false,
  requireEmailVerification: false,
  verifyEmailMethod: 'code',
  resetPasswordMethod: 'code',
};

const USER_RECORD = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'user@example.com',
  profile: { name: 'Ada' },
  metadata: {},
  email_verified: true,
  is_anonymous: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  password: undefined,
};

describe('AuthService email OTP sign-in', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(AuthService, 'instance', undefined);
    mocks.pool.connect.mockResolvedValue(mocks.client);
    mocks.getAuthConfig.mockResolvedValue(AUTH_CONFIG);
    mocks.createEmailOTP.mockResolvedValue({
      success: true,
      otp: '123456',
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    mocks.attemptEmailOTPWithCode.mockResolvedValue({
      success: true,
      value: {
        success: true,
        email: 'user@example.com',
        purpose: 'SIGN_IN',
      },
    });
    mocks.sendWithTemplate.mockResolvedValue(undefined);
    mocks.generateAccessToken.mockReturnValue('access-token');
    authService = AuthService.getInstance();
    vi.spyOn(authService, 'getUserById').mockResolvedValue(USER_RECORD);
  });

  it('sends request-otp without creating a user when signups are enabled', async () => {
    await authService.sendSignInOTP('user@example.com');

    expect(mocks.createEmailOTP).toHaveBeenCalledWith(
      'user@example.com',
      'SIGN_IN',
      'NUMERIC_CODE',
      { expiresInMinutes: 5 }
    );
    expect(mocks.sendWithTemplate).toHaveBeenCalledWith('user@example.com', 'User', 'request-otp', {
      token: '123456',
    });
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('uses the same send path when signups are disabled', async () => {
    mocks.getAuthConfig.mockResolvedValue({ ...AUTH_CONFIG, disableSignup: true });

    await authService.sendSignInOTP('unknown@example.com');

    expect(mocks.createEmailOTP).toHaveBeenCalledWith(
      'unknown@example.com',
      'SIGN_IN',
      'NUMERIC_CODE',
      { expiresInMinutes: 5 }
    );
    expect(mocks.sendWithTemplate).toHaveBeenCalledWith(
      'unknown@example.com',
      'User',
      'request-otp',
      { token: '123456' }
    );
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('creates a verified passwordless user only after a valid OTP', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ disable_signup: false }] })
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await authService.signInWithOTP('user@example.com', '123456', 'Ada Lovelace');

    const insertCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
    );
    expect(insertCall?.[1]).toEqual([
      expect.any(String),
      'user@example.com',
      JSON.stringify({ name: 'Ada Lovelace' }),
    ]);
    expect(insertCall?.[0]).toContain('NULL');
    expect(insertCall?.[0]).toContain('true');
    expect(
      mocks.client.query.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO auth.user_providers') &&
          params?.[0] === USER_RECORD.id &&
          params?.[1] === 'user@example.com'
      )
    ).toBe(true);
    expect(result).toMatchObject({
      user: { email: 'user@example.com', emailVerified: true },
      accessToken: 'access-token',
    });
  });

  it('removes the password when OTP verifies a pre-existing unverified user', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: USER_RECORD.id, email_verified: false }],
      })
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id }] })
      .mockResolvedValueOnce({ rows: [] });

    await authService.signInWithOTP('user@example.com', '123456');

    const updateCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('SET password = NULL')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([USER_RECORD.id]);
  });

  it('does not create a user when public signups are disabled', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ disable_signup: true }] });

    await expect(authService.signInWithOTP('new@example.com', '123456')).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.AUTH_SIGNUP_DISABLED,
    });

    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
      )
    ).toBe(false);
    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('FOR SHARE')
      )
    ).toBe(true);
  });

  it('recovers when another signup creates the user concurrently', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ disable_signup: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: USER_RECORD.id, email_verified: false }],
      })
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id }] })
      .mockResolvedValueOnce({ rows: [] });

    await authService.signInWithOTP('user@example.com', '123456');

    const insertCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
    );
    expect(insertCall?.[0]).toContain('ON CONFLICT (email) DO NOTHING');
    expect(
      mocks.client.query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM auth.users')
      )
    ).toHaveLength(2);
    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('SET password = NULL')
      )
    ).toBe(true);
  });

  it('commits a failed OTP attempt without looking up or creating a user', async () => {
    const invalidCode = new AppError(
      'Invalid or expired verification code',
      400,
      ERROR_CODES.INVALID_INPUT
    );
    mocks.attemptEmailOTPWithCode.mockResolvedValue({
      success: false,
      error: invalidCode,
    });
    mocks.client.query.mockResolvedValue({ rows: [] });

    await expect(authService.signInWithOTP('user@example.com', '000000')).rejects.toBe(invalidCode);

    expect(mocks.client.query).toHaveBeenCalledWith('COMMIT');
    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM auth.users')
      )
    ).toBe(false);
  });
});
