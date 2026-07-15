import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const { mockVerifyCloudToken, mockGenerateAccessToken, mockOAuthProvider } = vi.hoisted(() => ({
  mockVerifyCloudToken: vi.fn(),
  mockGenerateAccessToken: vi.fn().mockReturnValue('internal-access-token'),
  mockOAuthProvider: { getInstance: () => ({}) },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => ({ query: vi.fn(), connect: vi.fn() }) }),
  },
}));
vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyCloudToken: mockVerifyCloudToken,
      generateAccessToken: mockGenerateAccessToken,
    }),
  },
}));
vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: { getInstance: () => ({}) },
  OTPPurpose: {},
  OTPType: {},
}));
vi.mock('../../src/services/email/smtp-config.service.js', () => ({
  SmtpConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/email/email.service.js', () => ({
  EmailService: { getInstance: () => ({}) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/utils/environment.js', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));
vi.mock('../../src/infra/config/app.config.js', () => {
  const c = {
    auth: { rootAdminUsername: 'admin', rootAdminPassword: 'admin-password' },
    cloud: { projectId: 'project_123', apiHost: 'https://mock-api.dev' },
    app: { jwtSecret: 'test-secret-key' },
  };
  return { config: c, appConfig: c };
});

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
vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: mockOAuthProvider,
}));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: mockOAuthProvider,
}));

import { AuthService } from '../../src/services/auth/auth.service.js';

describe('AuthService.adminLoginWithAuthorizationCode', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  it('issues a namespaced admin subject when userId is present', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project_123',
      payload: { userId: 'user_123', projectId: 'project_123' },
    });

    const result = await authService.adminLoginWithAuthorizationCode('cloud-jwt');

    expect(result.admin.sub).toBe('cloud:user_123');
    expect(mockGenerateAccessToken).toHaveBeenCalledWith({
      sub: 'cloud:user_123',
      role: 'project_admin',
    });
    expect(result.accessToken).toBe('internal-access-token');
  });

  it('trims whitespace from userId before constructing the subject', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project_123',
      payload: { userId: '  user_456  ', projectId: 'project_123' },
    });

    const result = await authService.adminLoginWithAuthorizationCode('cloud-jwt');

    expect(result.admin.sub).toBe('cloud:user_456');
  });

  it('rejects tokens with a missing userId claim', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project_123',
      payload: { projectId: 'project_123' },
    });

    await expect(authService.adminLoginWithAuthorizationCode('cloud-jwt')).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
      message: 'Invalid cloud admin token: missing user identity',
    });
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects tokens with an empty userId claim', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project_123',
      payload: { userId: '   ', projectId: 'project_123' },
    });

    await expect(authService.adminLoginWithAuthorizationCode('cloud-jwt')).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
    });
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });
});
