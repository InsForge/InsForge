import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ROOT_ADMIN_USERNAME = 'admin';
process.env.ROOT_ADMIN_PASSWORD = 'admin-password';

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
  OTPPurpose: {
    VERIFY_EMAIL: 'VERIFY_EMAIL',
    RESET_PASSWORD: 'RESET_PASSWORD',
    SIGN_IN: 'SIGN_IN',
  },
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

vi.mock('../../src/infra/config/app.config', () => {
  const appConfig = {
    app: { jwtSecret: 'test-secret', name: 'test' },
    cloud: { projectId: null },
    auth: { rootAdminUsername: 'admin', rootAdminPassword: 'admin-password' },
  };
  return { appConfig, config: appConfig };
});

vi.mock('../../src/utils/environment', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { AuthService } from '../../src/services/auth/auth.service';

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

  it('locks, deletes the users and then their OTP rows in one transaction', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
      })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce(undefined);

    const deleted = await authService.deleteUsers(['user-1', 'user-2']);

    expect(deleted).toBe(2);
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(2, expect.stringContaining('FOR UPDATE'), [
      'user-1',
      'user-2',
    ]);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      'DELETE FROM auth.users WHERE id IN ($1,$2) RETURNING email',
      ['user-1', 'user-2']
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('DELETE FROM auth.email_otps'),
      [['alice@example.com', 'bob@example.com'], 'SIGN_IN']
    );
    const otpSql = mockClient.query.mock.calls[3][0] as string;
    expect(otpSql).toContain('otp.purpose <> $2 AND otp.email = ANY($1::text[])');
    expect(otpSql).toContain('lower(otp.email) IN');
    expect(otpSql).toContain('NOT EXISTS');
    expect(mockClient.query).toHaveBeenNthCalledWith(5, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('locks case-variant users in id order before deleting', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'User@example.com' }] })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce(undefined);

    await authService.deleteUsers(['user-1']);

    const lockSql = (mockClient.query.mock.calls[1][0] as string).replace(/\s+/g, ' ');
    expect(lockSql).toContain('SELECT id FROM auth.users');
    expect(lockSql).toContain(
      'OR lower(email) IN ( SELECT lower(email) FROM auth.users WHERE id IN ($1) )'
    );
    expect(lockSql).toContain('ORDER BY id FOR UPDATE');
    expect(mockClient.query.mock.calls[1][1]).toEqual(['user-1']);
    expect(mockClient.query.mock.calls[2][0]).toContain('DELETE FROM auth.users');
  });

  it('skips OTP cleanup when no matching users are found', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce(undefined);

    const deleted = await authService.deleteUsers(['missing-user']);

    expect(deleted).toBe(0);
    expect(mockClient.query).toHaveBeenCalledTimes(4);
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM auth.email_otps'),
      expect.anything()
    );
  });

  it('rolls back and releases the client when deleting users fails, preserving the original error', async () => {
    const originalError = new Error('delete failed');
    const rollbackError = new Error('rollback failed');

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(rollbackError);

    await expect(authService.deleteUsers(['user-1'])).rejects.toBe(originalError);

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(3, 'ROLLBACK');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledWith(rollbackError);
  });

  it('releases the client normally when rollback succeeds', async () => {
    const originalError = new Error('delete failed');

    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(originalError)
      .mockResolvedValueOnce(undefined);

    await expect(authService.deleteUsers(['user-1'])).rejects.toBe(originalError);

    expect(mockClient.release).toHaveBeenCalledTimes(1);
    expect(mockClient.release).toHaveBeenCalledWith(undefined);
  });

  it('retries the transaction when it is aborted as a deadlock victim', async () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    mockClient.query
      // attempt 1: BEGIN, lock, DELETE users, OTP delete deadlocks, ROLLBACK
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'alice@example.com' }] })
      .mockRejectedValueOnce(deadlock)
      .mockResolvedValueOnce(undefined)
      // attempt 2 succeeds
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce(undefined);

    const deleted = await authService.deleteUsers(['user-1']);

    expect(deleted).toBe(1);
    expect(mockPool.connect).toHaveBeenCalledTimes(2);
    expect(mockClient.query).toHaveBeenNthCalledWith(5, 'ROLLBACK');
    expect(mockClient.query).toHaveBeenNthCalledWith(10, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(2);
  });

  it('gives up after repeated deadlocks', async () => {
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });

    for (let i = 0; i < 3; i++) {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(deadlock)
        .mockResolvedValueOnce(undefined);
    }

    await expect(authService.deleteUsers(['user-1'])).rejects.toBe(deadlock);
    expect(mockPool.connect).toHaveBeenCalledTimes(3);
  });
});
