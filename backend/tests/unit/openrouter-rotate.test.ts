import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const environmentMock = vi.hoisted(() => ({
  isCloud: true,
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => environmentMock.isCloud,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

type ProviderState = OpenRouterProvider & {
  cloudCredentials?: unknown;
  openRouterClient: unknown | null;
  currentApiKey?: string;
  renewalPromise: Promise<string> | null;
  fetchPromise: Promise<string> | null;
  rotationPromise: Promise<string> | null;
};

function resetProviderState(provider: OpenRouterProvider) {
  const state = provider as unknown as ProviderState;
  state.cloudCredentials = undefined;
  state.openRouterClient = null;
  state.currentApiKey = undefined;
  state.renewalPromise = null;
  state.fetchPromise = null;
  state.rotationPromise = null;
}

describe('OpenRouterProvider.rotateManagedApiKey', () => {
  const jwtSecret = 'test-secret-long-enough-for-signing-32chars';
  let provider: OpenRouterProvider;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    environmentMock.isCloud = true;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PROJECT_ID', 'project_123');
    vi.stubEnv('JWT_SECRET', jwtSecret);
    vi.stubEnv('CLOUD_API_HOST', 'https://cloud.example');
    provider = OpenRouterProvider.getInstance();
    resetProviderState(provider);
  });

  afterEach(() => {
    resetProviderState(provider);
  });

  it('posts to the cloud rotate endpoint, caches the new key, and returns a masked key', async () => {
    const rotatedKey = 'sk-or-rotated-1234567890';
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          openrouter: {
            api_key: rotatedKey,
            limit_remaining: 42,
          },
        }),
    });

    const result = await provider.rotateManagedApiKey();

    expect(result).toEqual({
      apiKey: rotatedKey,
      maskedKey: `${rotatedKey.slice(0, 8)}••••••••${rotatedKey.slice(-4)}`,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.example/ai/v1/credentials/project_123/rotate');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(String(options.body)) as { sign: string };
    const payload = jwt.verify(body.sign, jwtSecret) as JwtPayload;
    expect(payload.projectId).toBe('project_123');

    await expect(provider.getMaskedApiKey()).resolves.toMatchObject({
      apiKey: rotatedKey,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects rotation for self-hosted environment keys', async () => {
    environmentMock.isCloud = false;

    await expect(provider.rotateManagedApiKey()).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.INVALID_INPUT,
      message: expect.stringContaining('Cloud-managed keys'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
