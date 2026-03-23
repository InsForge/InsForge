import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'change-this-password';

const {
  deviceAuthorizationServiceMock,
  tokenManagerMock,
  oauthProviderStub,
} = vi.hoisted(() => {
  const deviceAuthorizationServiceMock = {
    exchangeApproved: vi.fn(
      async (
        _deviceCode: string,
        mintSession: (userId: string) => Promise<unknown>
      ) => mintSession('11111111-1111-1111-1111-111111111111')
    ),
  };

  const tokenManagerMock = {
    generateAccessToken: vi.fn(() => 'access-token-123'),
  };

  const oauthProviderStub = {
    getInstance: () => ({}),
  };

  return {
    deviceAuthorizationServiceMock,
    tokenManagerMock,
    oauthProviderStub,
  };
});

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => tokenManagerMock,
  },
}));

vi.mock('../../src/services/auth/device-authorization.service.js', () => ({
  DeviceAuthorizationService: {
    getInstance: () => deviceAuthorizationServiceMock,
  },
}));

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: oauthProviderStub,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AuthService } from '../../src/services/auth/auth.service.js';

describe('device auth session exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (AuthService as unknown as { instance?: AuthService }).instance = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a standard non-web session payload for an approved device authorization', async () => {
    const authService = AuthService.getInstance();

    vi.spyOn(authService as any, 'getUserById').mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      email: 'device-user@example.com',
      profile: { name: 'Device User' },
      metadata: { source: 'device' },
      email_verified: true,
      is_project_admin: false,
      is_anonymous: false,
      created_at: '2026-03-24T00:00:00.000Z',
      updated_at: '2026-03-24T00:00:00.000Z',
      password: 'hashed-password',
      providers: 'email',
    });

    const session = await authService.exchangeApprovedDeviceAuthorization('device-code-123');

    expect(deviceAuthorizationServiceMock.exchangeApproved).toHaveBeenCalledWith(
      'device-code-123',
      expect.any(Function)
    );
    expect(session).toMatchObject({
      accessToken: 'access-token-123',
      user: {
        email: 'device-user@example.com',
      },
    });
    expect(session).not.toHaveProperty('refreshToken');
    expect(tokenManagerMock.generateAccessToken).toHaveBeenCalledWith({
      sub: '11111111-1111-1111-1111-111111111111',
      email: 'device-user@example.com',
      role: 'authenticated',
    });
  });
});
