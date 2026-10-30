import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  verifyAppleIdToken: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
  getAuthConfig: vi.fn(),
  generateAccessToken: vi.fn().mockReturnValue('access-token'),
  makeProviderMock: () => ({
    getInstance: () => ({
      generateOAuthUrl: vi.fn(),
      handleCallback: vi.fn(),
      handleSharedCallback: vi.fn(),
    }),
  }),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => mocks.pool }) },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({ generateAccessToken: mocks.generateAccessToken }),
  },
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: { getInstance: () => ({ listConfigs: vi.fn() }) },
}));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getAuthConfig: mocks.getAuthConfig,
      validateRedirectUrl: vi.fn(),
    }),
  },
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

vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: {
    auth: { rootAdminUsername: 'admin@test.com', rootAdminPassword: 'password123' },
    app: { jwtSecret: 'test-secret' },
    cloud: { projectId: null },
  },
}));

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: {
    getInstance: () => ({ verifyToken: mocks.verifyGoogleIdToken }),
  },
}));
vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: mocks.makeProviderMock(),
}));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: {
    getInstance: () => ({ verifyIdToken: mocks.verifyAppleIdToken }),
  },
}));

import { AuthService } from '../../src/services/auth/auth.service.js';

const session = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'relay@privaterelay.appleid.com',
    emailVerified: true,
    providers: ['apple'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    profile: { name: 'Apple User', avatar_url: '' },
    metadata: null,
  },
  accessToken: 'access-token',
};

describe('AuthService native ID-token sign-in', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.query.mockResolvedValue({ rows: [] });
    mocks.getAuthConfig.mockResolvedValue({ disableSignup: false });
    (AuthService as unknown as { instance?: AuthService }).instance = undefined;
    service = AuthService.getInstance();
  });

  it('verifies Apple using the native audience set and nonce', async () => {
    mocks.verifyAppleIdToken.mockResolvedValue({
      sub: 'apple-subject',
      email: 'Relay@privaterelay.appleid.com',
      email_verified: true,
      is_private_email: true,
    });
    const findOrCreate = vi.spyOn(service, 'findOrCreateThirdPartyUser').mockResolvedValue(session);

    await service.signInWithIdToken('apple', 'apple-token', {
      nonce: 'native-nonce',
      name: 'First Sign In Name',
    });

    expect(mocks.verifyAppleIdToken).toHaveBeenCalledWith('apple-token', {
      nonce: 'native-nonce',
      native: true,
    });
    expect(findOrCreate).toHaveBeenCalledWith(
      'apple',
      'apple-subject',
      'relay@privaterelay.appleid.com',
      'First Sign In Name',
      '',
      expect.objectContaining({ sub: 'apple-subject', is_private_email: true }),
      { requireEmailForNewAccount: true }
    );
  });

  it('requires a nonce before invoking Apple verification', async () => {
    await expect(service.signInWithIdToken('apple', 'apple-token')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
    expect(mocks.verifyAppleIdToken).not.toHaveBeenCalled();
  });

  it('passes the exact raw nonce to Apple verification', async () => {
    mocks.verifyAppleIdToken.mockResolvedValue({
      sub: 'apple-subject',
      email: 'relay@privaterelay.appleid.com',
      email_verified: true,
    });
    vi.spyOn(service, 'findOrCreateThirdPartyUser').mockResolvedValue(session);

    await service.signInWithIdToken('apple', 'apple-token', {
      nonce: '  native-nonce  ',
    });

    expect(mocks.verifyAppleIdToken).toHaveBeenCalledWith('apple-token', {
      nonce: '  native-nonce  ',
      native: true,
    });
  });

  it('maps Apple verification failures to an authentication error', async () => {
    mocks.verifyAppleIdToken.mockRejectedValue(new Error('nonce mismatch'));

    await expect(
      service.signInWithIdToken('apple', 'apple-token', { nonce: 'native-nonce' })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_UNAUTHORIZED',
    });
  });

  it('does not use an unverified Apple email for account linking', async () => {
    mocks.verifyAppleIdToken.mockResolvedValue({
      sub: 'apple-subject',
      email: 'victim@example.com',
      email_verified: false,
    });
    const findOrCreate = vi.spyOn(service, 'findOrCreateThirdPartyUser').mockResolvedValue(session);

    await service.signInWithIdToken('apple', 'apple-token', { nonce: 'native-nonce' });

    expect(findOrCreate.mock.calls[0]?.[2]).toBe('');
  });

  it('lets an existing Apple subject sign in when profile claims are absent', async () => {
    mocks.pool.query
      .mockResolvedValueOnce({
        rows: [{ user_id: '00000000-0000-4000-8000-000000000001' }],
      })
      .mockResolvedValue({ rows: [] });
    vi.spyOn(service, 'getUserById').mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'relay@privaterelay.appleid.com',
      email_verified: true,
      profile: { name: 'Apple User', avatar_url: '' },
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      auth_metadata: null,
    });

    await expect(
      service.findOrCreateThirdPartyUser('apple', 'apple-subject', '', 'Apple User', '', {
        sub: 'apple-subject',
        email: '',
      })
    ).resolves.toMatchObject({ accessToken: 'access-token' });
  });

  it('rejects a new Apple identity without a verified email', async () => {
    mocks.pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      service.findOrCreateThirdPartyUser(
        'apple',
        'new-apple-subject',
        '',
        'Apple User',
        '',
        {
          sub: 'new-apple-subject',
          email: '',
        },
        { requireEmailForNewAccount: true }
      )
    ).rejects.toThrow('A verified email address is required');
    expect(mocks.pool.query).toHaveBeenCalledOnce();
  });

  it('links Apple identities to case-variant existing emails', async () => {
    const existingUserId = '00000000-0000-4000-8000-000000000002';
    mocks.pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: existingUserId, email: 'Relay@Example.com' }],
      })
      .mockResolvedValue({ rows: [] });
    vi.spyOn(service, 'getUserById').mockResolvedValue({
      id: existingUserId,
      email: 'Relay@Example.com',
      email_verified: true,
      profile: { name: 'Existing User', avatar_url: '' },
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      auth_metadata: null,
    });

    await service.findOrCreateThirdPartyUser(
      'apple',
      'apple-subject',
      'relay@example.com',
      'Apple User',
      '',
      { sub: 'apple-subject', email: 'relay@example.com' },
      { requireEmailForNewAccount: true }
    );

    expect(mocks.pool.query.mock.calls[1]?.[0]).toContain('lower(email) = lower($1)');
    expect(mocks.pool.query.mock.calls[1]?.[1]).toEqual(['relay@example.com']);
    expect(mocks.pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO auth.user_providers'),
      expect.arrayContaining([existingUserId, 'apple', 'apple-subject'])
    );
  });

  it('keeps Google ID-token sign-in behavior unchanged', async () => {
    mocks.verifyGoogleIdToken.mockResolvedValue({
      sub: 'google-subject',
      email: 'google@example.com',
      name: 'Google User',
      picture: 'https://example.com/avatar.png',
    });
    const findOrCreate = vi.spyOn(service, 'findOrCreateThirdPartyUser').mockResolvedValue(session);

    await service.signInWithIdToken('google', 'google-token');

    expect(findOrCreate).toHaveBeenCalledWith(
      'google',
      'google-subject',
      'google@example.com',
      'Google User',
      'https://example.com/avatar.png',
      expect.objectContaining({ sub: 'google-subject' }),
      undefined
    );
  });
});
