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
  consumeNumericOTP: vi.fn(),
  sendSignInCode: vi.fn(),
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
      consumeNumericOTP: mocks.consumeNumericOTP,
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

vi.mock('../../src/services/sms/sms.service.js', () => ({
  SmsService: {
    getInstance: () => ({
      sendSignInCode: mocks.sendSignInCode,
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

const PHONE = '+15551234567';

const USER_RECORD = {
  id: '22222222-2222-4222-8222-222222222222',
  email: null,
  profile: { name: 'Ada' },
  metadata: {},
  email_verified: false,
  phone_number: PHONE,
  phone_verified: true,
  is_anonymous: false,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  password: undefined,
};

describe('AuthService phone OTP sign-in', () => {
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
    // By default the helper verifies successfully and runs the caller's work on
    // the mock client, mirroring a committed transaction.
    mocks.consumeNumericOTP.mockImplementation((phone, purpose, _code, onVerified) =>
      onVerified(mocks.client, { success: true, email: phone, purpose, redirectTo: null })
    );
    mocks.sendSignInCode.mockResolvedValue(undefined);
    mocks.generateAccessToken.mockReturnValue('access-token');
    authService = AuthService.getInstance();
    vi.spyOn(authService, 'getUserById').mockResolvedValue(USER_RECORD);
  });

  it('sends the code over SMS without creating or looking up a user', async () => {
    await authService.sendPhoneSignInOTP(PHONE);

    expect(mocks.createEmailOTP).toHaveBeenCalledWith(PHONE, 'SIGN_IN', 'NUMERIC_CODE', {
      expiresInMinutes: 5,
    });
    expect(mocks.sendSignInCode).toHaveBeenCalledWith(PHONE, '123456');
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('uses the same send path when signups are disabled', async () => {
    mocks.getAuthConfig.mockResolvedValue({ ...AUTH_CONFIG, disableSignup: true });

    await authService.sendPhoneSignInOTP(PHONE);

    expect(mocks.createEmailOTP).toHaveBeenCalledWith(PHONE, 'SIGN_IN', 'NUMERIC_CODE', {
      expiresInMinutes: 5,
    });
    expect(mocks.sendSignInCode).toHaveBeenCalled();
    expect(mocks.pool.query).not.toHaveBeenCalled();
  });

  it('surfaces the provider error when SMS is disabled or unconfigured', async () => {
    const notConfigured = new AppError(
      'An SMS provider must be configured before phone sign-in can be used.',
      400,
      ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED
    );
    mocks.sendSignInCode.mockRejectedValue(notConfigured);

    await expect(authService.sendPhoneSignInOTP(PHONE)).rejects.toBe(notConfigured);
  });

  it('creates a phone-verified user without an email only after a valid OTP', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT auth.users (no existing user)
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id }] }) // INSERT auth.users
      .mockResolvedValueOnce({ rows: [] }); // INSERT auth.user_providers

    const result = await authService.signInWithPhoneOTP(PHONE, '123456', 'Ada Lovelace');

    expect(mocks.consumeNumericOTP).toHaveBeenCalledWith(
      PHONE,
      'SIGN_IN',
      '123456',
      expect.any(Function)
    );

    const insertCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
    );
    expect(insertCall?.[1]).toEqual([
      expect.any(String),
      JSON.stringify({ name: 'Ada Lovelace' }),
      PHONE,
    ]);
    // email NULL, password NULL, phone_verified true at insert.
    expect(insertCall?.[0]).toContain('NULL, NULL');
    expect(insertCall?.[0]).toContain('phone_verified');
    expect(
      mocks.client.query.mock.calls.some(
        ([sql, params]) =>
          typeof sql === 'string' &&
          sql.includes('INSERT INTO auth.user_providers') &&
          sql.includes("'phone'") &&
          params?.[0] === USER_RECORD.id &&
          params?.[1] === PHONE
      )
    ).toBe(true);
    expect(result).toMatchObject({
      user: { email: null, phone: PHONE, phoneVerified: true },
      accessToken: 'access-token',
    });
  });

  it('signs in an existing user and never touches their password', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id, phone_verified: true }] }) // SELECT auth.users (found)
      .mockResolvedValueOnce({ rows: [] }); // INSERT auth.user_providers

    await authService.signInWithPhoneOTP(PHONE, '123456');

    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
      )
    ).toBe(false);
    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('password')
      )
    ).toBe(false);
  });

  it('marks the phone verified for a pre-existing unverified row', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [{ id: USER_RECORD.id, phone_verified: false }] })
      .mockResolvedValueOnce({ rows: [] }) // UPDATE phone_verified = true
      .mockResolvedValueOnce({ rows: [] }); // INSERT auth.user_providers

    await authService.signInWithPhoneOTP(PHONE, '123456');

    const updateCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('SET phone_verified = true')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([USER_RECORD.id]);
  });

  it('rejects a first-time signup with 403 when signups are disabled, without creating a user', async () => {
    mocks.getAuthConfig.mockResolvedValue({ ...AUTH_CONFIG, disableSignup: true });
    mocks.client.query.mockResolvedValueOnce({ rows: [] }); // SELECT auth.users (no existing user)

    await expect(authService.signInWithPhoneOTP(PHONE, '123456')).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.AUTH_SIGNUP_DISABLED,
    });

    // The helper already consumed/committed the code; signInWithPhoneOTP only
    // blocks the account creation and never writes to auth.users.
    expect(mocks.consumeNumericOTP).toHaveBeenCalledWith(
      PHONE,
      'SIGN_IN',
      '123456',
      expect.any(Function)
    );
    expect(
      mocks.client.query.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
      )
    ).toBe(false);
  });

  it('surfaces the verification error when the OTP is invalid', async () => {
    const invalidCode = new AppError(
      'Invalid or expired verification code',
      400,
      ERROR_CODES.INVALID_INPUT
    );
    mocks.consumeNumericOTP.mockRejectedValue(invalidCode);

    await expect(authService.signInWithPhoneOTP(PHONE, '000000')).rejects.toBe(invalidCode);

    // A failed attempt never runs the user-creation callback.
    expect(mocks.client.query).not.toHaveBeenCalled();
  });

  it('recovers when another signup creates the user concurrently', async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [] }) // SELECT auth.users (no existing user)
      .mockResolvedValueOnce({ rows: [] }) // INSERT auth.users (concurrent conflict → no row)
      .mockResolvedValueOnce({
        rows: [{ id: USER_RECORD.id, phone_verified: true }],
      }) // re-SELECT auth.users (found)
      .mockResolvedValueOnce({ rows: [] }); // INSERT auth.user_providers

    await authService.signInWithPhoneOTP(PHONE, '123456');

    const insertCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.users')
    );
    expect(insertCall?.[0]).toContain('ON CONFLICT (phone_number) DO NOTHING');
    expect(
      mocks.client.query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM auth.users')
      )
    ).toHaveLength(2);
  });
});
