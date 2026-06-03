import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'change-this-password';

const { mockGenerateAccessToken, mockOAuthProvider, mockPoolQuery, mockVerifyCloudToken } =
  vi.hoisted(() => ({
    mockGenerateAccessToken: vi.fn().mockReturnValue('admin-access-token'),
    mockOAuthProvider: { getInstance: () => ({}) },
    mockPoolQuery: vi.fn(),
    mockVerifyCloudToken: vi.fn(),
  }));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: mockPoolQuery,
      }),
    }),
  },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: mockGenerateAccessToken,
      verifyCloudToken: mockVerifyCloudToken,
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('@/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('@/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: mockOAuthProvider,
}));
vi.mock('@/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: mockOAuthProvider,
}));

import { AuthService } from '../../src/services/auth/auth.service';

describe('AuthService project admins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.set(AuthService, 'instance', undefined);
  });

  it('rejects cloud admin tokens without a valid email claim before touching the database', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project-1',
      payload: { sub: 'cloud-subject' },
    });

    const authService = AuthService.getInstance();

    await expect(authService.adminLoginWithAuthorizationCode('cloud-token')).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it('upserts cloud admins using the minimal project_admins schema', async () => {
    mockVerifyCloudToken.mockResolvedValue({
      projectId: 'project-1',
      payload: { email: 'Admin@Example.com', sub: 'cloud-subject' },
    });
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: '3cb9a3b5-89de-4421-bcc1-0afbcba607ec',
          email: 'admin@example.com',
          created_at: '2026-06-03T00:00:00.000Z',
          updated_at: '2026-06-03T00:00:00.000Z',
        },
      ],
    });

    const authService = AuthService.getInstance();
    const result = await authService.adminLoginWithAuthorizationCode('cloud-token');
    const [sql, params] = mockPoolQuery.mock.calls[0];

    expect(String(sql)).toContain(
      'INSERT INTO auth.project_admins (email, created_at, updated_at)'
    );
    expect(String(sql)).not.toContain('source');
    expect(String(sql)).not.toContain('external_subject');
    expect(String(sql)).not.toContain('profile');
    expect(params).toEqual(['admin@example.com']);
    expect(result.user).toMatchObject({
      id: '3cb9a3b5-89de-4421-bcc1-0afbcba607ec',
      email: 'admin@example.com',
      providers: [],
      profile: { name: 'Administrator' },
    });
    expect(mockGenerateAccessToken).toHaveBeenCalledWith({
      sub: '3cb9a3b5-89de-4421-bcc1-0afbcba607ec',
      email: 'admin@example.com',
      role: 'project_admin',
    });
  });
});
