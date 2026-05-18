import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin-password';

const { mockPool, mockClient, mockOAuthProvider } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockOAuthProvider: { getInstance: () => ({}) },
}));

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

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
      generateRefreshToken: vi.fn().mockReturnValue('test-refresh-token'),
      generateCsrfToken: vi.fn().mockReturnValue('test-csrf-token'),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-config.service', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn(),
      getPublicAuthConfig: vi.fn(),
      validateRedirectUrl: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service', () => ({
  AuthOTPService: {
    getInstance: () => ({
      createEmailOTP: vi.fn(),
      verifyEmailOTPWithCode: vi.fn(),
      verifyEmailOTPWithToken: vi.fn(),
      getEmailOTPContextByToken: vi.fn(),
    }),
  },
  OTPPurpose: { VERIFY_EMAIL: 'VERIFY_EMAIL', RESET_PASSWORD: 'RESET_PASSWORD' },
  OTPType: { NUMERIC_CODE: 'NUMERIC_CODE', HASH_TOKEN: 'HASH_TOKEN' },
}));

vi.mock('../../src/services/auth/oauth-config.service', () => ({
  OAuthConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service', () => ({
  CustomOAuthConfigService: {
    getInstance: () => ({
      listConfigs: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('../../src/services/email/email.service', () => ({
  EmailService: {
    getInstance: () => ({
      sendWithTemplate: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../src/services/email/smtp-config.service', () => ({
  SmtpConfigService: {
    getInstance: () => ({
      getConfig: vi.fn(),
    }),
  },
}));

vi.mock('../../src/providers/oauth/google.provider', () => ({
  GoogleOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/github.provider', () => ({
  GitHubOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/discord.provider', () => ({
  DiscordOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/linkedin.provider', () => ({
  LinkedInOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/facebook.provider', () => ({
  FacebookOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/microsoft.provider', () => ({
  MicrosoftOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/x.provider', () => ({ XOAuthProvider: mockOAuthProvider }));
vi.mock('../../src/providers/oauth/apple.provider', () => ({
  AppleOAuthProvider: mockOAuthProvider,
}));

vi.mock('../../src/utils/environment', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { AuthService } from '../../src/services/auth/auth.service';
import { ADMIN_ID } from '../../src/utils/constants';

describe('AuthService.deleteUsers', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  it('deletes OTP rows for deleted users before deleting the users', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
      })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce(undefined);

    const deleted = await authService.deleteUsers(['user-1', 'user-2']);

    expect(deleted).toBe(2);
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      `SELECT email
         FROM auth.users
         WHERE id IN ($1,$2)`,
      ['user-1', 'user-2']
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM auth.email_otps WHERE email = ANY($1::text[])',
      [['alice@example.com', 'bob@example.com']]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      4,
      'DELETE FROM auth.users WHERE id IN ($1,$2)',
      ['user-1', 'user-2']
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('skips OTP cleanup when no matching users are found', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    const deleted = await authService.deleteUsers(['missing-user']);

    expect(deleted).toBe(0);
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'DELETE FROM auth.users WHERE id IN ($1)', [
      'missing-user',
    ]);
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM auth.email_otps WHERE email = ANY($1::text[])',
      expect.anything()
    );
  });

  it('does nothing when only the admin account is provided', async () => {
    const deleted = await authService.deleteUsers([ADMIN_ID]);

    expect(deleted).toBe(0);
    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});
