/**
 * X shared-key OAuth called a cloud endpoint that does not exist, and after the #2051
 * hardening its callback could not be satisfied at all: the init request carried no
 * project or flow binding (#2053). The branch is gone, so a config that still carries
 * the flag fails at login with a configuration error instead of a broken redirect.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { XOAuthProvider } from '../../src/providers/oauth/x.provider.js';

const mocks = vi.hoisted(() => ({
  getConfigByProvider: vi.fn(),
  axiosGet: vi.fn(),
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: {
    getInstance: () => ({
      getConfigByProvider: mocks.getConfigByProvider,
      getClientSecretByProvider: vi.fn(),
    }),
  },
}));

vi.mock('../../src/utils/environment.js', () => ({
  getApiBaseUrl: () => 'http://localhost:7130',
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { get: mocks.axiosGet, post: vi.fn(), isAxiosError: vi.fn() },
}));

describe('XOAuthProvider.generateOAuthUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a config that asks for InsForge shared keys', async () => {
    mocks.getConfigByProvider.mockResolvedValue({ provider: 'x', useSharedKey: true });

    await expect(XOAuthProvider.getInstance().generateOAuthUrl('state-1')).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR,
      name: 'AppError',
    });
  });

  it('never calls the cloud for a shared-key X config', async () => {
    mocks.getConfigByProvider.mockResolvedValue({ provider: 'x', useSharedKey: true });

    await expect(XOAuthProvider.getInstance().generateOAuthUrl('state-2')).rejects.toThrow();
    expect(mocks.axiosGet).not.toHaveBeenCalled();
  });

  it('still builds the direct authorization URL from the project credentials', async () => {
    mocks.getConfigByProvider.mockResolvedValue({
      provider: 'x',
      clientId: 'client-id',
      useSharedKey: false,
      scopes: ['tweet.read', 'users.read'],
    });

    const authUrl = new URL(await XOAuthProvider.getInstance().generateOAuthUrl('state-3'));

    expect(authUrl.origin + authUrl.pathname).toBe('https://twitter.com/i/oauth2/authorize');
    expect(authUrl.searchParams.get('client_id')).toBe('client-id');
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'http://localhost:7130/api/auth/oauth/x/callback'
    );
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
