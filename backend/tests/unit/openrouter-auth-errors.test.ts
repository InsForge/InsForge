import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';

const { mockGetApiKeyWithSource, mockGetClient, mockRenewCloudApiKey } = vi.hoisted(() => ({
  mockGetApiKeyWithSource: vi.fn(),
  mockGetClient: vi.fn(),
  mockRenewCloudApiKey: vi.fn(),
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OpenRouterProvider } from '../../src/providers/ai/openrouter.provider.js';
import { ERROR_CODES } from '../../src/types/error-constants.js';

function createAPIError(
  status: number,
  message: string,
  headers: Headers = new Headers()
): OpenAI.APIError {
  return new OpenAI.APIError(status, { message }, message, headers);
}

describe('OpenRouterProvider authentication error handling', () => {
  let provider: OpenRouterProvider;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn> | undefined;
  let recordedDelays: number[] = [];

  // Resolve setTimeout immediately so retry backoff loops complete in real time
  // during these tests. Match the codebase pattern used by deno-subhosting-429
  // and vercel-429-helper tests.
  function installFastSetTimeout(): void {
    recordedDelays = [];
    const realSetTimeout = global.setTimeout;
    setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation(((
      cb: (...args: unknown[]) => void,
      ms?: number
    ) => {
      recordedDelays.push(ms ?? 0);
      return realSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provider = OpenRouterProvider.getInstance();

    // Patch private methods for focused provider error tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as Record<string, any>;
    p.getApiKeyWithSource = mockGetApiKeyWithSource;
    p.getClient = mockGetClient.mockResolvedValue(new OpenAI({ apiKey: 'test' }));
    p.renewCloudApiKey = mockRenewCloudApiKey;
  });

  afterEach(() => {
    setTimeoutSpy?.mockRestore();
    setTimeoutSpy = undefined;
    recordedDelays = [];
  });

  it('throws AppError with AI_INVALID_API_KEY for env key 401', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(401, 'Unauthorized');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      message: expect.stringContaining('authentication failed'),
    });
  });

  it('throws AppError with AI_INVALID_API_KEY for env key 403', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(403, 'Forbidden');
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AI_INVALID_API_KEY,
      nextActions: expect.stringContaining('OPENROUTER_API_KEY'),
    });
  });

  it('throws AppError with RATE_LIMITED for 429 after exhausting retries', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });
    installFastSetTimeout();

    const request = vi.fn(() => {
      throw createAPIError(429, 'Rate limited');
    });

    await expect(provider.sendRequest(request)).rejects.toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: expect.stringContaining('after 3 retries'),
    });

    // initial call + 3 retry attempts = 4 invocations
    expect(request).toHaveBeenCalledTimes(4);
    // 3 retry delays should have been scheduled
    expect(recordedDelays.length).toBeGreaterThanOrEqual(3);
  });

  it('retries 429 and succeeds on second attempt', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });
    installFastSetTimeout();

    const request = vi
      .fn()
      .mockImplementationOnce(() => {
        throw createAPIError(429, 'Rate limited');
      })
      .mockResolvedValueOnce({ ok: true });

    const { result, source } = await provider.sendRequest(request);

    expect(result).toEqual({ ok: true });
    expect(source).toBe('env');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('honors Retry-After header when present', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });
    installFastSetTimeout();

    const headers = new Headers({ 'retry-after': '2' });
    const request = vi
      .fn()
      .mockImplementationOnce(() => {
        throw createAPIError(429, 'Rate limited', headers);
      })
      .mockResolvedValueOnce({ ok: true });

    const { result } = await provider.sendRequest(request);

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    // The single retry delay should equal the Retry-After value (2s = 2000ms),
    // not the exponential-backoff fallback (1000ms on attempt 1).
    expect(recordedDelays).toContain(2000);
  });

  it('caps Retry-After at 30s on 429', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });
    installFastSetTimeout();

    // Upstream asks us to wait 10 minutes; cap should kick in.
    const headers = new Headers({ 'retry-after': '600' });
    const request = vi
      .fn()
      .mockImplementationOnce(() => {
        throw createAPIError(429, 'Rate limited', headers);
      })
      .mockResolvedValueOnce({ ok: true });

    await provider.sendRequest(request);

    // No requested delay should exceed the 30s cap.
    for (const d of recordedDelays) {
      expect(d).toBeLessThanOrEqual(30_000);
    }
    // And the retry actually used the capped value.
    expect(recordedDelays).toContain(30_000);
  });

  it('still throws raw error for non-API errors', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    const networkError = new Error('ECONNREFUSED');

    await expect(
      provider.sendRequest(() => {
        throw networkError;
      })
    ).rejects.toBe(networkError);
  });

  it('still throws raw error for 500 API errors', async () => {
    mockGetApiKeyWithSource.mockResolvedValue({ apiKey: 'env-key', source: 'env' });

    await expect(
      provider.sendRequest(() => {
        throw createAPIError(500, 'Internal Server Error');
      })
    ).rejects.toBeInstanceOf(OpenAI.APIError);
  });
});
