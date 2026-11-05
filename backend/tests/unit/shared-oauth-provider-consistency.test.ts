/**
 * #2051 hardened the shared OAuth callback but updated seven of the eight providers
 * that post to it, leaving X on the pre-hardening init query (#2053). These drive the
 * real init call for every shared-key provider and assert the project and flow bindings
 * the callback requires, so a provider that reaches the shared callback without them
 * fails here rather than at a user's login.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { sharedKeyOAuthProviders, isSharedKeyOAuthProvider } from '@insforge/shared-schemas';

// Deliberately carries characters that percent-encode: microsoft.provider.ts encodes the
// state into the callback path while the other six inline it raw, and both must still
// name the same login attempt.
const STATE = 'state under+test/2053';

const mocks = vi.hoisted(() => ({
  projectId: 'project-under-test',
  getConfigByProvider: vi.fn(),
  axiosGet: vi.fn(),
  signCloudToken: vi.fn(() => 'project-sign-token'),
}));

const PROJECT_ID = mocks.projectId;

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: {
    getInstance: () => ({
      getConfigByProvider: mocks.getConfigByProvider,
      getClientSecretByProvider: vi.fn(),
    }),
  },
}));
vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({ signCloudToken: mocks.signCloudToken }) },
}));
vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: {
    app: { jwtSecret: 'test-secret' },
    cloud: { projectId: mocks.projectId, apiHost: 'https://api.insforge.test' },
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

import {
  AppleOAuthProvider,
  DiscordOAuthProvider,
  FacebookOAuthProvider,
  GitHubOAuthProvider,
  GoogleOAuthProvider,
  LinkedInOAuthProvider,
  MicrosoftOAuthProvider,
} from '../../src/providers/oauth/index.js';

interface SharedKeyProvider {
  generateOAuthUrl(state?: string, additionalParams?: Record<string, string>): Promise<string>;
}

const providerInstances: Record<string, () => SharedKeyProvider> = {
  google: () => GoogleOAuthProvider.getInstance(),
  github: () => GitHubOAuthProvider.getInstance(),
  discord: () => DiscordOAuthProvider.getInstance(),
  linkedin: () => LinkedInOAuthProvider.getInstance(),
  facebook: () => FacebookOAuthProvider.getInstance(),
  apple: () => AppleOAuthProvider.getInstance(),
  microsoft: () => MicrosoftOAuthProvider.getInstance(),
};

describe('shared-key OAuth providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfigByProvider.mockResolvedValue({ useSharedKey: true });
    mocks.axiosGet.mockResolvedValue({
      data: { auth_url: 'https://provider.example/authorize?client_id=shared' },
    });
    mocks.signCloudToken.mockReturnValue('project-sign-token');
  });

  it('has an instance for every provider on the shared-key list', () => {
    expect(Object.keys(providerInstances).sort()).toEqual([...sharedKeyOAuthProviders].sort());
  });

  it.each([...sharedKeyOAuthProviders])(
    'binds the %s init request to this project and login attempt',
    async (provider) => {
      await providerInstances[provider]().generateOAuthUrl(STATE);

      expect(mocks.axiosGet).toHaveBeenCalledTimes(1);
      const initUrl = new URL(mocks.axiosGet.mock.calls[0][0] as string);

      const redirectUri = initUrl.searchParams.get('redirect_uri') ?? '';
      const callbackPrefix = 'http://localhost:7130/api/auth/oauth/shared/callback/';

      expect(redirectUri.startsWith(callbackPrefix)).toBe(true);
      // Express decodes the path parameter, so either spelling reaches the callback as
      // the state that flow_id below is derived from
      expect(decodeURIComponent(redirectUri.slice(callbackPrefix.length))).toBe(STATE);
      expect(initUrl.searchParams.get('project_id')).toBe(PROJECT_ID);
      expect(initUrl.searchParams.get('sign')).toBe('project-sign-token');
      expect(initUrl.searchParams.get('flow_id')).toBe(
        crypto.createHash('sha256').update(STATE).digest('hex')
      );
    }
  );

  it.each([...sharedKeyOAuthProviders])(
    'returns the authorization url the cloud issued for %s',
    async (provider) => {
      const authUrl = await providerInstances[provider]().generateOAuthUrl(STATE);

      expect(authUrl).toContain('https://provider.example/authorize');
    }
  );
});

describe('shared callback reach', () => {
  const providerDir = resolve(__dirname, '../../src/providers/oauth');

  const providersPostingToSharedCallback = readdirSync(providerDir)
    .filter((file) => file.endsWith('.provider.ts'))
    .filter((file) => !['base.provider.ts', 'custom.provider.ts'].includes(file))
    .filter((file) => readFileSync(resolve(providerDir, file), 'utf-8').includes('shared/callback'))
    .map((file) => file.replace('.provider.ts', ''))
    .sort();

  // The bindings above are only enforceable for providers the cloud proxies, so no
  // other provider may send users to the shared callback.
  it('is limited to providers on the shared-key list', () => {
    expect(providersPostingToSharedCallback).toEqual([...sharedKeyOAuthProviders].sort());
  });

  it('keeps X off the shared-key list', () => {
    expect(isSharedKeyOAuthProvider('x')).toBe(false);
    expect(isSharedKeyOAuthProvider('google')).toBe(true);
  });

  it('matches the shared-key list case-insensitively, as config lookups do', () => {
    expect(isSharedKeyOAuthProvider('Google')).toBe(true);
    expect(isSharedKeyOAuthProvider('X')).toBe(false);
  });
});
