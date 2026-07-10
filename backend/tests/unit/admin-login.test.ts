import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

// Required env vars before any imports
process.env.ROOT_ADMIN_USERNAME = 'admin@test.com';
process.env.ROOT_ADMIN_PASSWORD = 'admin-password';

const { mockPool, mockTokenManager, mockOAuthProvider } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockTokenManager: {
    generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
  },
  mockOAuthProvider: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
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
      getAuthConfig: vi.fn(),
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: {
    getInstance: () => ({
      generateOTP: vi.fn().mockResolvedValue('123456'),
    }),
  },
  OTPPurpose: { VERIFY_EMAIL: 'VERIFY_EMAIL' },
  OTPType: { CODE: 'CODE' },
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/email/email.service.js', () => ({
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

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => mockTokenManager,
  },
}));

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/x.provider.js', () => ({ XOAuthProvider: mockOAuthProvider }));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: mockOAuthProvider,
}));

vi.mock('../../src/infra/config/app.config.js', () => {
  const c = {
    app: { jwtSecret: 'test-secret', name: 'test' },
    cloud: { projectId: null },
    auth: { rootAdminUsername: 'admin@test.com', rootAdminPassword: 'admin-password' },
  };
  return {
    config: c,
    appConfig: c,
    getApiBaseUrl: () => 'http://localhost:3000',
  };
});

import { AuthService } from '../../src/services/auth/auth.service.js';

describe('AuthService.adminLogin', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    mockTokenManager.generateAccessToken.mockReturnValue('test-access-token');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  function expectAdminLoginError(username: string, password: string) {
    try {
      authService.adminLogin(username, password);
      expect.fail('Should have thrown an error');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AppError);
      const appErr = error as AppError;
      expect(appErr.message).toBe('Invalid admin credentials');
      expect(appErr.statusCode).toBe(401);
      expect(appErr.code).toBe(ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  it('successfully logs in with correct credentials', () => {
    const result = authService.adminLogin('admin@test.com', 'admin-password');
    expect(result).toEqual({
      admin: { sub: 'local:admin@test.com' },
      accessToken: 'test-access-token',
    });
    expect(mockTokenManager.generateAccessToken).toHaveBeenCalledWith({
      sub: 'local:admin@test.com',
      role: 'project_admin',
    });
  });

  it('throws AppError when username is incorrect but password is correct', () => {
    expectAdminLoginError('wrong-admin@test.com', 'admin-password');
  });

  it('throws AppError when password is incorrect but username is correct', () => {
    expectAdminLoginError('admin@test.com', 'wrong-password');
  });

  it('throws AppError when both username and password are incorrect', () => {
    expectAdminLoginError('wrong-admin@test.com', 'wrong-password');
  });

  it('throws AppError when inputs are empty strings', () => {
    expectAdminLoginError('', '');
  });

  it('handles credentials of different lengths safely up to 256 characters', () => {
    const longUsername = 'a'.repeat(256);
    const longPassword = 'b'.repeat(256);
    expectAdminLoginError(longUsername, longPassword);
  });

  it('immediately rejects credentials exceeding 256 characters', () => {
    const hugeUsername = 'a'.repeat(257);
    const hugePassword = 'b'.repeat(257);
    expectAdminLoginError(hugeUsername, 'admin-password');
    expectAdminLoginError('admin@test.com', hugePassword);
  });
});
