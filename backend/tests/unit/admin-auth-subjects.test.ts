import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const adminServiceMock = vi.hoisted(() => ({
  verifyCredentials: vi.fn(),
  getAdminByUsername: vi.fn(),
  createAdmin: vi.fn(),
  changePassword: vi.fn(),
}));

const tokenManagerMock = vi.hoisted(() => ({
  generateAccessToken: vi.fn(() => 'access-token'),
  verifyCloudToken: vi.fn(),
}));

vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: {
    app: { jwtSecret: 'x'.repeat(32) },
    auth: {
      rootAdminUsername: 'root',
      rootAdminPassword: 'secret',
    },
    cloud: { apiHost: 'https://api.insforge.dev' },
  },
}));

vi.mock('../../src/services/admin/admin.service.js', () => ({
  adminService: adminServiceMock,
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => ({ query: vi.fn(), connect: vi.fn() }) }),
  },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => tokenManagerMock },
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
  getApiBaseUrl: () => 'http://localhost:7130',
}));

const makeOAuthProviderMock = () => ({
  getInstance: () => ({
    generateOAuthUrl: vi.fn(),
    handleCallback: vi.fn(),
    handleSharedCallback: vi.fn(),
  }),
});

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: makeOAuthProviderMock(),
}));

async function getAuthService() {
  const { AuthService } = await import('../../src/services/auth/auth.service.js');
  return AuthService.getInstance();
}

describe('AuthService admin subjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses local:<root username> with root metadata for env root login', async () => {
    const authService = await getAuthService();

    const result = await authService.adminLogin('root', 'secret');

    expect(result.admin).toEqual({
      sub: 'local:root',
      username: 'root',
      isRoot: true,
    });
    expect(tokenManagerMock.generateAccessToken).toHaveBeenCalledWith({
      sub: 'local:root',
      role: 'project_admin',
    });
  });

  it('uses local:<username> instead of UUID for DB admins', async () => {
    adminServiceMock.verifyCredentials.mockResolvedValue({
      id: '65cbdc8d-15d9-4619-bcde-58217609d84f',
      username: 'alice',
    });
    const authService = await getAuthService();

    const result = await authService.adminLogin('alice', 'password');

    expect(result.admin).toEqual({
      sub: 'local:alice',
      username: 'alice',
      isRoot: false,
    });
    expect(tokenManagerMock.generateAccessToken).toHaveBeenCalledWith({
      sub: 'local:alice',
      role: 'project_admin',
    });
  });

  it('does not fall back to DB credentials for the root username', async () => {
    const authService = await getAuthService();

    await expect(authService.adminLogin('root', 'wrong-password')).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AUTH_UNAUTHORIZED,
    });
    expect(adminServiceMock.verifyCredentials).not.toHaveBeenCalled();
  });

  it('rejects creating a DB admin with the root username', async () => {
    const authService = await getAuthService();

    await expect(authService.createAdmin('root', 'password')).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.AUTH_EMAIL_EXISTS,
    });
    expect(adminServiceMock.createAdmin).not.toHaveBeenCalled();
  });

  it('validates local DB admin subjects against active DB rows', async () => {
    adminServiceMock.getAdminByUsername.mockResolvedValue({
      id: '65cbdc8d-15d9-4619-bcde-58217609d84f',
      username: 'alice',
    });
    const authService = await getAuthService();

    await expect(authService.getActiveAdminSessionFromSubject('local:alice')).resolves.toEqual({
      sub: 'local:alice',
      username: 'alice',
      isRoot: false,
    });
    expect(adminServiceMock.getAdminByUsername).toHaveBeenCalledWith('alice');
  });

  it('skips DB lookup for cloud admin subjects', async () => {
    const authService = await getAuthService();

    await expect(authService.getActiveAdminSessionFromSubject('cloud:user-1')).resolves.toEqual({
      sub: 'cloud:user-1',
      isRoot: false,
    });
    expect(adminServiceMock.getAdminByUsername).not.toHaveBeenCalled();
  });

  it('rejects password changes for cloud admin subjects before DB lookup', async () => {
    const authService = await getAuthService();

    await expect(
      authService.changeAdminPassword('cloud:user-1', 'old-password', 'new-password')
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(adminServiceMock.getAdminByUsername).not.toHaveBeenCalled();
  });
});
