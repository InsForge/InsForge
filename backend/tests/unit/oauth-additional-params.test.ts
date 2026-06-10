import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { oAuthInitRequestSchema } from '@insforge/shared-schemas';
import { GoogleOAuthProvider } from '../../src/providers/oauth/google.provider.js';

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
  default: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
    post: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

const VALID_CODE_CHALLENGE = 'abcdefghijklmnopqrstuvwxyzABCDE1234567890-_';

describe('OAuth additional params', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires redirect_uri in OAuth init requests', () => {
    const validation = oAuthInitRequestSchema.safeParse({
      code_challenge: VALID_CODE_CHALLENGE,
    });

    expect(validation.success).toBe(false);
    if (validation.success) {
      throw new Error('Expected OAuth init request validation to fail');
    }
    expect(validation.error.issues[0]?.path).toEqual(['redirect_uri']);
  });

  it('accepts provider-specific flat string params in OAuth init requests', () => {
    const validation = oAuthInitRequestSchema.safeParse({
      redirect_uri: 'http://localhost:3000/dashboard',
      code_challenge: VALID_CODE_CHALLENGE,
      prompt: 'select_account',
      login_hint: 'person@example.com',
    });

    expect(validation.success).toBe(true);
    if (!validation.success) {
      throw new Error('Expected OAuth init request validation to pass');
    }
    expect(validation.data).toMatchObject({
      prompt: 'select_account',
      login_hint: 'person@example.com',
    });
  });

  it('passes additional params to provider URLs without overriding server-owned params', async () => {
    mocks.getConfigByProvider.mockResolvedValue({
      clientId: 'google-client-id',
      scopes: ['openid', 'email'],
      useSharedKey: false,
    });

    const provider = GoogleOAuthProvider.getInstance();
    const url = new URL(
      await provider.generateOAuthUrl('state-token', {
        client_id: 'attacker-client-id',
        prompt: 'select_account',
        redirect_uri: 'https://evil.example/callback',
        scope: 'profile',
      })
    );

    expect(url.searchParams.get('client_id')).toBe('google-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:7130/api/auth/oauth/google/callback'
    );
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('uses a descriptive error when shared OAuth does not return an auth URL', async () => {
    mocks.getConfigByProvider.mockResolvedValue({
      clientId: 'google-client-id',
      scopes: ['openid', 'email'],
      useSharedKey: true,
    });
    vi.mocked(axios.get).mockResolvedValue({ data: {} });

    const provider = GoogleOAuthProvider.getInstance();

    await expect(provider.generateOAuthUrl('state-token')).rejects.toThrow(
      'Shared Google OAuth did not return an authorization URL'
    );
  });
});
