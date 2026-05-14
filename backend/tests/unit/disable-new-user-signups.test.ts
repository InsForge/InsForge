import { beforeEach, describe, expect, it, vi } from 'vitest';

// Required env vars before any imports
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin-password';

const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

// Toggle this in individual tests via mockGetAuthConfig.mockResolvedValueOnce(...)
const mockGetAuthConfig = vi.fn();

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/services/auth/auth-config.service', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: mockGetAuthConfig,
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service', () => ({
  AuthOTPService: {
    getInstance: () => ({
      generateOTP: vi.fn().mockResolvedValue('123456'),
    }),
  },
  OTPPurpose: { VERIFY_EMAIL: 'VERIFY_EMAIL' },
  OTPType: { CODE: 'CODE' },
}));

vi.mock('../../src/services/auth/oauth-config.service', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service', () => ({
  CustomOAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/email/email.service', () => ({
  EmailService: {
    getInstance: () => ({
      sendMail: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
    }),
  },
}));

const mockOAuthProvider = { getInstance: () => ({}) };
vi.mock('../../src/providers/oauth/google.oauth.provider', () => ({
  GoogleOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/github.oauth.provider', () => ({
  GitHubOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/discord.oauth.provider', () => ({
  DiscordOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/facebook.oauth.provider', () => ({
  FacebookOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/microsoft.oauth.provider', () => ({
  MicrosoftOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/x.oauth.provider', () => ({
  XOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/apple.oauth.provider', () => ({
  AppleOAuthProvider: mockOAuthProvider,
}));

vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    app: { jwtSecret: 'test-secret', name: 'test' },
    cloud: { projectId: null },
  },
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { AuthService } from '../../src/services/auth/auth.service';

const DISABLED_CONFIG = {
  requireEmailVerification: false,
  passwordMinLength: 6,
  requireNumber: false,
  requireLowercase: false,
  requireUppercase: false,
  requireSpecialChar: false,
  verifyEmailMethod: 'code' as const,
  resetPasswordMethod: 'code' as const,
  allowedRedirectUrls: [],
  disableSignup: true,
};

const ENABLED_CONFIG = { ...DISABLED_CONFIG, disableSignup: false };

const FAKE_DB_USER = {
  id: 'user-uuid-1',
  email: 'existing@test.com',
  profile: { name: 'Existing User' },
  email_verified: true,
  created_at: new Date(),
  updated_at: new Date(),
  auth_metadata: null,
  is_project_admin: false,
};

describe('AuthService.findOrCreateThirdPartyUser – disableSignup gate', () => {
  let authService: AuthService;

  beforeEach(() => {
    // resetAllMocks clears one-time queues (mockResolvedValueOnce) unlike clearAllMocks
    vi.resetAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  it('throws AUTH_SIGNUP_DISABLED for brand-new OAuth user when toggle is on', async () => {
    // No existing provider account, no existing email user
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // auth.user_providers lookup
      .mockResolvedValueOnce({ rows: [] }); // auth.users email lookup

    mockGetAuthConfig.mockResolvedValueOnce(DISABLED_CONFIG);

    await expect(
      authService.findOrCreateThirdPartyUser(
        'google',
        'google-id-new',
        'newuser@test.com',
        'New User',
        '',
        {}
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTH_SIGNUP_DISABLED',
    });
  });

  it('allows existing OAuth user (found by provider ID) even when toggle is on', async () => {
    // Existing provider account found — this is a returning OAuth user
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-uuid-1', provider: 'google' }] }) // user_providers lookup
      .mockResolvedValueOnce({ rows: [] }) // UPDATE user_providers (updated_at)
      .mockResolvedValueOnce({ rows: [] }); // UPDATE auth.users (email_verified)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(authService as any, 'getUserById').mockResolvedValue(FAKE_DB_USER);

    const result = await authService.findOrCreateThirdPartyUser(
      'google',
      'google-id-existing',
      'existing@test.com',
      'Existing User',
      '',
      {}
    );

    expect(result.user.email).toBe('existing@test.com');
    // getAuthConfig should never be called (gate is only reached for new users)
    expect(mockGetAuthConfig).not.toHaveBeenCalled();
  });

  it('allows existing email user linking new OAuth provider even when toggle is on', async () => {
    // No provider account but user exists by email — linking, not new signup
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // user_providers lookup
      .mockResolvedValueOnce({ rows: [FAKE_DB_USER] }) // email lookup
      .mockResolvedValueOnce({ rows: [] }) // INSERT user_providers
      .mockResolvedValueOnce({ rows: [] }); // UPDATE email_verified

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(authService as any, 'getUserById').mockResolvedValue(FAKE_DB_USER);

    const result = await authService.findOrCreateThirdPartyUser(
      'github',
      'github-id-new',
      'existing@test.com',
      'Existing User',
      '',
      {}
    );

    expect(result.user.email).toBe('existing@test.com');
    expect(mockGetAuthConfig).not.toHaveBeenCalled();
  });

  it('allows brand-new OAuth user when toggle is off', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] }) // user_providers lookup
      .mockResolvedValueOnce({ rows: [] }); // email lookup

    mockGetAuthConfig.mockResolvedValueOnce(ENABLED_CONFIG);

    // createThirdPartyUser will be called — spy to avoid full DB simulation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(authService as any, 'createThirdPartyUser').mockResolvedValue({
      user: { id: 'new-id', email: 'brand-new@test.com' },
      accessToken: 'token',
    });

    const result = await authService.findOrCreateThirdPartyUser(
      'google',
      'google-id-brand-new',
      'brand-new@test.com',
      'Brand New',
      '',
      {}
    );

    expect(result.user.email).toBe('brand-new@test.com');
    expect(mockGetAuthConfig).toHaveBeenCalledOnce();
  });
});
