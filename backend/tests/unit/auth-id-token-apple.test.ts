import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const mockVerifyIdToken = vi.fn();

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
    }),
  },
}));

vi.mock('../../src/services/auth/auth-config.service', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: vi.fn().mockResolvedValue({
        requireEmailVerification: false,
        disableSignup: false,
      }),
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
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

vi.mock('../../src/providers/oauth/google.provider', () => ({
  GoogleOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/github.provider', () => ({
  GitHubOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/discord.provider', () => ({
  DiscordOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/linkedin.provider', () => ({
  LinkedInOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/facebook.provider', () => ({
  FacebookOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/microsoft.provider', () => ({
  MicrosoftOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/x.provider', () => ({
  XOAuthProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/oauth/apple.provider', () => ({
  AppleOAuthProvider: {
    getInstance: () => ({
      verifyIdToken: mockVerifyIdToken,
    }),
  },
}));

vi.mock('../../src/infra/config/app.config', () => ({
  config: {
    app: { jwtSecret: 'test-secret', name: 'test' },
    cloud: { projectId: null },
  },
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { AuthService } from '../../src/services/auth/auth.service';
import { AppError } from '../../src/api/middlewares/error';

describe('AuthService.signInWithIdToken – apple', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({ rows: [] });
    mockClient.query.mockResolvedValue({ rows: [] });

    const authServiceCtor = AuthService as unknown as {
      instance?: unknown;
    };
    authServiceCtor.instance = undefined;
    authService = AuthService.getInstance();

    const getUserByIdFn = authService as unknown as {
      getUserById: (id: string) => Promise<unknown>;
    };
    vi.spyOn(getUserByIdFn, 'getUserById').mockResolvedValue({
      id: 'apple-user-id',
      email: 'apple@example.com',
      profile: { name: 'Apple User' },
      email_verified: true,
      created_at: new Date(),
      updated_at: new Date(),
      auth_metadata: null,
    });
  });

  it('returns a session for a valid Apple ID token when user already exists', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-123',
      email: 'apple@example.com',
      email_verified: true,
      is_private_email: false,
    });

    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: 'apple-user-id',
            provider: 'apple',
            provider_account_id: 'apple-sub-123',
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const result = await authService.signInWithIdToken('apple', 'valid-apple-token');

    expect(result.user.email).toBe('apple@example.com');
    expect(result.accessToken).toBe('test-access-token');
  });

  it('creates a new user when no existing account or email match is found', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'new-apple-sub',
      email: 'newapple@example.com',
      email_verified: true,
    });

    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await authService.signInWithIdToken('apple', 'valid-apple-token');

    expect(result.user.email).toBe('newapple@example.com');
  });

  it('throws when the Apple ID token is missing the sub claim', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: '',
      email: 'apple@example.com',
    });

    await expect(authService.signInWithIdToken('apple', 'bad-token')).rejects.toThrow(
      new AppError('Invalid Apple ID token: missing sub claim', 400, 'INVALID_INPUT')
    );
  });

  it('uses a deterministic placeholder email when Apple omits the email claim', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-789',
      email: '',
    });

    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await authService.signInWithIdToken('apple', 'valid-apple-token');

    expect(result.user.email).toBe('apple-apple-sub-789@placeholder.local');
  });

  it('throws when token verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await expect(authService.signInWithIdToken('apple', 'invalid-token')).rejects.toThrow(
      new AppError('Failed to verify Apple ID token', 400, 'INVALID_INPUT')
    );
  });

  it('handles private relay emails correctly', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-456',
      email: 'privaterelay@appleid.apple.com',
      email_verified: true,
      is_private_email: true,
    });

    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await authService.signInWithIdToken('apple', 'valid-apple-token');

    expect(result.user.email).toBe('privaterelay@appleid.apple.com');
  });
  it('passes allowed audience to Apple verification', async () => {
    process.env.APPLE_ALLOWED_AUDIENCES = 'com.example.ios,com.other.app';
    mockVerifyIdToken.mockResolvedValue({
      sub: 'apple-sub-aud',
      email: 'aud@example.com',
    });
    mockPool.query.mockResolvedValue({ rows: [] });
    await authService.signInWithIdToken('apple', 'valid-apple-token', 'com.example.ios');
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-apple-token', 'com.example.ios');
  });
  it('rejects unallowed audience', async () => {
    process.env.APPLE_ALLOWED_AUDIENCES = 'com.allowed.bundle';
    await expect(
      authService.signInWithIdToken('apple', 'valid-apple-token', 'com.bad.app')
    ).rejects.toThrow(new AppError('Audience is not allowed for Apple ID token', 400, 'INVALID_INPUT'));
  });
  it('rejects when provider returns sub literal "undefined"', async () => {
    mockVerifyIdToken.mockResolvedValue({
      sub: 'undefined',
      email: 'x@example.com',
    });
    await expect(authService.signInWithIdToken('apple', 'valid-apple-token')).rejects.toThrow(
      new AppError('Invalid Apple ID token: missing sub claim', 400, 'INVALID_INPUT')
    );
  });
});
