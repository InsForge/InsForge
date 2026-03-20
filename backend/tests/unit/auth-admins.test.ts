import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';

const mockPool = {
  query: vi.fn(),
};

const mockGenerateAccessToken = vi.fn();

const providerInstance = {};

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: mockGenerateAccessToken,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/auth/oauth-config.service', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/auth-config.service', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn().mockResolvedValue({
        requireEmailVerification: true,
        passwordMinLength: 8,
        requireNumber: false,
        requireLowercase: false,
        requireUppercase: false,
        requireSpecialChar: false,
        verifyEmailMethod: 'code',
        resetPasswordMethod: 'code',
        signInRedirectTo: null,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-otp.service', () => ({
  AuthOTPService: { getInstance: () => ({}) },
  OTPPurpose: {},
  OTPType: {},
}));

vi.mock('../../src/services/email/email.service', () => ({
  EmailService: { getInstance: () => ({}) },
}));

vi.mock('../../src/providers/oauth/google.provider', () => ({
  GoogleOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/github.provider', () => ({
  GitHubOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/discord.provider', () => ({
  DiscordOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/linkedin.provider', () => ({
  LinkedInOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/facebook.provider', () => ({
  FacebookOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/microsoft.provider', () => ({
  MicrosoftOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/x.provider', () => ({
  XOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/providers/oauth/apple.provider', () => ({
  AppleOAuthProvider: { getInstance: () => providerInstance },
}));

vi.mock('../../src/utils/environment', () => ({
  getApiBaseUrl: () => 'http://localhost:7130',
}));

describe('AuthService project admin support', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAIL = 'bootstrap@example.com';
    process.env.ADMIN_PASSWORD = 'bootstrap-password';

    const authModule = await import('../../src/services/auth/auth.service');
    (authModule.AuthService as unknown as { instance?: unknown }).instance = undefined;
  });

  it('keeps bootstrap admin login behavior for env credentials', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');
    mockGenerateAccessToken.mockReturnValue('bootstrap-token');

    const result = await AuthService.getInstance().adminLogin(
      'bootstrap@example.com',
      'bootstrap-password'
    );

    expect(result.accessToken).toBe('bootstrap-token');
    expect(mockPool.query).not.toHaveBeenCalled();
    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'bootstrap@example.com',
        role: 'project_admin',
      })
    );
  });

  it('allows database-backed project admins to log in through admin sessions', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');
    const hashedPassword = await bcrypt.hash('member-password', 4);

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
          email: 'member@example.com',
          password: hashedPassword,
          email_verified: true,
          is_project_admin: true,
          is_anonymous: false,
          profile: { name: 'Member Admin' },
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          providers: 'email',
        },
      ],
    });
    mockGenerateAccessToken.mockReturnValue('db-admin-token');

    const result = await AuthService.getInstance().adminLogin(
      'member@example.com',
      'member-password'
    );

    expect(result.accessToken).toBe('db-admin-token');
    expect(result.user.id).toBe('8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67');
    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
        email: 'member@example.com',
        role: 'project_admin',
      })
    );
  });

  it('rejects non-admin database users for admin login', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');
    const hashedPassword = await bcrypt.hash('member-password', 4);

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '1711f9bf-b377-4471-95af-d55b8f5fa0ba',
          email: 'member@example.com',
          password: hashedPassword,
          email_verified: true,
          is_project_admin: false,
          is_anonymous: false,
          profile: { name: 'Regular User' },
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          providers: 'email',
        },
      ],
    });

    await expect(
      AuthService.getInstance().adminLogin('member@example.com', 'member-password')
    ).rejects.toThrow(AppError);
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects unverified database admins when email verification is required', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');
    const hashedPassword = await bcrypt.hash('member-password', 4);

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
          email: 'member@example.com',
          password: hashedPassword,
          email_verified: false,
          is_project_admin: true,
          is_anonymous: false,
          profile: { name: 'Member Admin' },
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          providers: 'email',
        },
      ],
    });

    await expect(
      AuthService.getInstance().adminLogin('member@example.com', 'member-password')
    ).rejects.toThrow(AppError);
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });

  it('lists admins when roleFilter is admins', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'bootstrap@example.com',
            password: 'ignored',
            email_verified: true,
            is_project_admin: true,
            is_anonymous: false,
            profile: { name: 'Administrator' },
            metadata: {},
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            providers: 'email',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ count: '1' }],
      });

    const result = await AuthService.getInstance().listUsers(10, 0, undefined, 'admins');

    expect(result.total).toBe(1);
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({
      email: 'bootstrap@example.com',
      isProjectAdmin: true,
      adminSource: 'bootstrap',
    });
  });

  it('blocks demoting the bootstrap admin', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');

    await expect(
      AuthService.getInstance().setProjectAdminStatus('00000000-0000-0000-0000-000000000001', false)
    ).rejects.toThrow(AppError);
  });

  it('allows anonymous users to be demoted from admin', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'd10f0e33-083f-435e-96ee-d4dff79eae1d',
            email: 'anon@example.com',
            password: null,
            email_verified: false,
            is_project_admin: true,
            is_anonymous: true,
            profile: null,
            metadata: {},
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            providers: 'anonymous',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 'd10f0e33-083f-435e-96ee-d4dff79eae1d' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'd10f0e33-083f-435e-96ee-d4dff79eae1d',
            email: 'anon@example.com',
            profile: null,
            metadata: {},
            email_verified: false,
            is_project_admin: false,
            is_anonymous: true,
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-02T00:00:00.000Z',
            providers: 'anonymous',
          },
        ],
      });

    const result = await AuthService.getInstance().setProjectAdminStatus(
      'd10f0e33-083f-435e-96ee-d4dff79eae1d',
      false
    );

    expect(result.isProjectAdmin).toBe(false);
    expect(result.providers).toEqual(['anonymous']);
  });

  it('rejects promoting passwordless users to admin', async () => {
    const { AuthService } = await import('../../src/services/auth/auth.service');

    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'a4cad96f-0e90-4dbb-aa63-4ca5a17bdcf1',
          email: 'oauth-user@example.com',
          password: null,
          email_verified: true,
          is_project_admin: false,
          is_anonymous: false,
          profile: { name: 'OAuth User' },
          metadata: {},
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z',
          providers: 'google',
        },
      ],
    });

    await expect(
      AuthService.getInstance().setProjectAdminStatus(
        'a4cad96f-0e90-4dbb-aa63-4ca5a17bdcf1',
        true
      )
    ).rejects.toThrow(AppError);
  });
});
