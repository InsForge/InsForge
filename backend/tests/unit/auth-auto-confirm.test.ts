import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set required env vars before any imports
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin-password';

const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
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
      generateOTP: vi.fn().mockResolvedValue('123456'),
    }),
  },
  OTPPurpose: { VERIFY_EMAIL: 'VERIFY_EMAIL' },
  OTPType: { CODE: 'CODE' },
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
      sendMail: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    app: {
      jwtSecret: 'test-secret',
      name: 'test',
    },
    cloud: {
      projectId: null,
    },
  },
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { AuthService } from '../../src/services/auth/auth.service';

describe('AuthService.register – autoConfirm', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
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
      auth_metadata: null,
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
});
