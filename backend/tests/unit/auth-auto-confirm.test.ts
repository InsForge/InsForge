import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set required env vars before any imports
process.env.ROOT_ADMIN_USERNAME = 'admin';
process.env.ROOT_ADMIN_PASSWORD = 'admin-password';

const { mockPool, mockClient, mockCreateEmailOTP, mockSendWithTemplate } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockCreateEmailOTP: vi.fn().mockResolvedValue({ otp: '123456' }),
  mockSendWithTemplate: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/services/auth/auth-config.service', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn().mockResolvedValue({
        requireEmailVerification: true,
        verifyEmailMethod: 'code',
        passwordMinLength: 8,
        passwordRequireUppercase: false,
        passwordRequireLowercase: false,
        passwordRequireNumbers: false,
        passwordRequireSymbols: false,
      }),
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service', () => ({
  AuthOTPService: {
    getInstance: () => ({
      createEmailOTP: mockCreateEmailOTP,
    }),
  },
  OTPPurpose: { VERIFY_EMAIL: 'VERIFY_EMAIL' },
  OTPType: { NUMERIC_CODE: 'NUMERIC_CODE', HASH_TOKEN: 'HASH_TOKEN' },
}));

vi.mock('../../src/services/auth/oauth-config.service', () => ({
  OAuthConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service', () => ({
  CustomOAuthConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/services/email/email.service', () => ({
  EmailService: {
    getInstance: () => ({
      sendWithTemplate: mockSendWithTemplate,
    }),
  },
}));

// Mock all OAuth providers the constructor initializes
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

vi.mock('../../src/infra/config/app.config', () => {
  const c = {
    app: {
      jwtSecret: 'test-secret',
      name: 'test',
    },
    cloud: {
      projectId: null,
    },
    auth: {
      rootAdminUsername: 'admin@test.com',
      rootAdminPassword: 'admin-password',
    },
  };
  return {
    config: c,
    appConfig: c,
    getApiBaseUrl: () => 'http://localhost:3000',
  };
});

import { AuthService } from '../../src/services/auth/auth.service';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';

describe('AuthService.register – autoConfirm', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'test-user-id',
          email: 'test@example.com',
          profile: { name: 'Test' },
        },
      ],
    });
    mockClient.query.mockResolvedValue({ rows: [] });
    // Reset singleton to get fresh instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
    // Mock getUserById to return a user record after INSERT
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(authService as any, 'getUserById').mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      profile: { name: 'Test' },
      email_verified: false,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: null,
      is_anonymous: false,
    });
  });

  it('sets email_verified=true when autoConfirm=true and isAdminCreation=true', async () => {
    const result = await authService.register(
      'test@example.com',
      'password123',
      'Test',
      undefined,
      { isAdminCreation: true, autoConfirm: true }
    );

    // Verify INSERT was called with email_verified=true (5th param)
    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO auth.users')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][4]).toBe(true);

    // Should not require email verification
    expect(result.requireEmailVerification).toBe(false);
  });

  it('sets email_verified=false when autoConfirm=false and isAdminCreation=true', async () => {
    const result = await authService.register(
      'test@example.com',
      'password123',
      'Test',
      undefined,
      { isAdminCreation: true, autoConfirm: false }
    );

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO auth.users')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][4]).toBe(false);

    expect(result.requireEmailVerification).toBe(true);
  });

  it('ignores autoConfirm=true when isAdminCreation is false', async () => {
    await authService.register('test@example.com', 'password123', 'Test', undefined, {
      isAdminCreation: false,
      autoConfirm: true,
    });

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO auth.users')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][4]).toBe(false);
  });

  it('preserves existing behavior when autoConfirm is omitted', async () => {
    const result = await authService.register(
      'test@example.com',
      'password123',
      'Test',
      undefined,
      { isAdminCreation: true }
    );

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO auth.users')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1][4]).toBe(false);

    expect(result.requireEmailVerification).toBe(true);
  });

  it('surfaces verification email failures during public registration', async () => {
    mockSendWithTemplate.mockRejectedValueOnce(new Error('SMTP send failed'));

    await expect(
      authService.register('test@example.com', 'password123', 'Test')
    ).rejects.toMatchObject({
      message: 'The user account was created, but the verification email could not be sent.',
      statusCode: 500,
      code: 'AUTH_VERIFICATION_EMAIL_DELIVERY_FAILED',
      nextActions:
        'The user account already exists. Retry delivery with POST /api/auth/email/send-verification instead of registering again.',
    });

    const insertCall = mockClient.query.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO auth.users')
    );
    expect(insertCall).toBeDefined();
  });

  it('preserves rate-limit status while using the registration delivery error code', async () => {
    mockSendWithTemplate.mockRejectedValueOnce(
      new AppError('Email rate limit exceeded', 429, ERROR_CODES.RATE_LIMITED)
    );

    await expect(
      authService.register('test@example.com', 'password123', 'Test')
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'AUTH_VERIFICATION_EMAIL_DELIVERY_FAILED',
      nextActions:
        'The user account already exists. Retry delivery with POST /api/auth/email/send-verification instead of registering again.',
    });
  });
});
