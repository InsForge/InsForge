import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VercelProvider } from '../../src/providers/deployments/vercel.provider';
import axios, { AxiosError, AxiosHeaders } from 'axios';

// Mock dependencies so we don't hit real APIs
vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

/**
 * Helper to create a mock Axios error with a given status code and optional headers
 */
function makeAxiosError(status: number, headers: Record<string, string> = {}): AxiosError {
  const error = new Error(`Request failed with status code ${status}`) as AxiosError;
  error.isAxiosError = true;
  error.response = {
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Internal Server Error',
    headers,
    data: {},
    config: { headers: new AxiosHeaders() },
  };
  error.config = { headers: new AxiosHeaders() };
  return error;
}

describe('VercelProvider.uploadFiles batching', () => {
  let provider: VercelProvider;
  let uploadFileSpy: ReturnType<typeof vi.spyOn>;
  let concurrentCount: number;
  let peakConcurrent: number;

  beforeEach(() => {
    // Reset singleton for clean tests
    // @ts-expect-error accessing private static for test reset
    VercelProvider.instance = undefined;
    provider = VercelProvider.getInstance();

    concurrentCount = 0;
    peakConcurrent = 0;

    // Mock uploadFile to track concurrency
    uploadFileSpy = vi.spyOn(provider, 'uploadFile').mockImplementation(async (content: Buffer) => {
      concurrentCount++;
      if (concurrentCount > peakConcurrent) {
        peakConcurrent = concurrentCount;
      }
      // Simulate network delay so concurrent calls overlap
      await new Promise((r) => setTimeout(r, 10));
      concurrentCount--;
      return `sha-${content.length}`;
    });
  });

  it('uploads all files and returns correct results', async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    const results = await provider.uploadFiles(files);

    expect(results).toHaveLength(25);
    expect(uploadFileSpy).toHaveBeenCalledTimes(25);
    results.forEach((r, i) => {
      expect(r.file).toBe(`file-${i}.txt`);
      expect(r.sha).toMatch(/^sha-/);
      expect(r.size).toBeGreaterThan(0);
    });
  });

  it('limits concurrency to 5 at a time', async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    await provider.uploadFiles(files);

    expect(peakConcurrent).toBeLessThanOrEqual(5);
    expect(peakConcurrent).toBeGreaterThan(1);
  });

  it('handles fewer files than batch size', async () => {
    const files = Array.from({ length: 3 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    const results = await provider.uploadFiles(files);

    expect(results).toHaveLength(3);
    expect(uploadFileSpy).toHaveBeenCalledTimes(3);
    expect(peakConcurrent).toBeLessThanOrEqual(3);
  });

  it('handles empty file list', async () => {
    const results = await provider.uploadFiles([]);

    expect(results).toHaveLength(0);
    expect(uploadFileSpy).not.toHaveBeenCalled();
  });

  it('handles exactly one batch (5 files)', async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    const results = await provider.uploadFiles(files);

    expect(results).toHaveLength(5);
    expect(peakConcurrent).toBeLessThanOrEqual(5);
  });

  it('propagates upload errors without swallowing them', async () => {
    uploadFileSpy.mockRejectedValueOnce(new Error('rate limited'));

    const files = [{ path: 'fail.txt', content: Buffer.from('fail') }];

    await expect(provider.uploadFiles(files)).rejects.toThrow('rate limited');
  });
});

describe('VercelProvider.uploadFile retry logic', () => {
  let provider: VercelProvider;
  let axiosPostSpy: ReturnType<typeof vi.spyOn>;
  const setTimeoutCalls: number[] = [];

  beforeEach(() => {
    // Deterministic jitter: Math.random always returns 0
    vi.spyOn(Math, 'random').mockReturnValue(0);

    // @ts-expect-error accessing private static for test reset
    VercelProvider.instance = undefined;
    provider = VercelProvider.getInstance();

    // Mock getCredentials to avoid real API calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(provider as any, 'getCredentials').mockResolvedValue({
      token: 'test-token',
      teamId: 'test-team',
      projectId: 'test-project',
      expiresAt: null,
      slug: null,
    });

    axiosPostSpy = vi.spyOn(axios, 'post');

    // Intercept setTimeout: record retry delays and resolve immediately.
    // Pass through short timeouts (vitest internals) to the real implementation.
    setTimeoutCalls.length = 0;
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: (...args: unknown[]) => void,
      ms?: number
    ) => {
      if (ms !== undefined && ms >= 1000) {
        setTimeoutCalls.push(ms);
        // Resolve on next microtask to keep async flow correct
        Promise.resolve().then(() => fn());
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries on 429 with exponential backoff', async () => {
    axiosPostSpy
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ status: 200, data: {} });

    const sha = await provider.uploadFile(Buffer.from('test-content'));

    expect(sha).toBeTruthy();
    expect(axiosPostSpy).toHaveBeenCalledTimes(3);
    // With Math.random()=0, jitter is 0. Backoff: attempt 0 = 1000ms, attempt 1 = 2000ms
    expect(setTimeoutCalls).toEqual([1000, 2000]);
  });

  it('respects X-RateLimit-Reset header on 429', async () => {
    // Vercel sends X-RateLimit-Reset as Unix epoch seconds
    const nowSec = Math.floor(Date.now() / 1000);
    const resetEpoch = nowSec + 5; // 5 seconds from now
    axiosPostSpy
      .mockRejectedValueOnce(makeAxiosError(429, { 'x-ratelimit-reset': String(resetEpoch) }))
      .mockResolvedValueOnce({ status: 200, data: {} });

    const sha = await provider.uploadFile(Buffer.from('test-content'));

    expect(sha).toBeTruthy();
    expect(axiosPostSpy).toHaveBeenCalledTimes(2);
    // Delay should be based on reset epoch, not exponential backoff
    // resetMs - Date.now() ≈ 5000ms (with jitter=0)
    expect(setTimeoutCalls.length).toBe(1);
    expect(setTimeoutCalls[0]).toBeGreaterThanOrEqual(4000);
    expect(setTimeoutCalls[0]).toBeLessThanOrEqual(5500);
  });

  it('throws RATE_LIMITED after max retries exhausted', async () => {
    axiosPostSpy.mockRejectedValue(makeAxiosError(429));

    await expect(provider.uploadFile(Buffer.from('test-content'))).rejects.toMatchObject({
      message: expect.stringContaining('rate limit'),
      statusCode: 429,
      code: 'RATE_LIMITED',
    });

    expect(axiosPostSpy).toHaveBeenCalledTimes(4);
    // 3 retries with backoff: 1000, 2000, 4000
    expect(setTimeoutCalls).toEqual([1000, 2000, 4000]);
  });

  it('does not retry on non-429 errors', async () => {
    axiosPostSpy.mockRejectedValueOnce(makeAxiosError(500));

    await expect(provider.uploadFile(Buffer.from('test-content'))).rejects.toMatchObject({
      statusCode: 500,
    });

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutCalls).toEqual([]);
  });

  it('still handles 409 (file exists) without retrying', async () => {
    axiosPostSpy.mockRejectedValueOnce(makeAxiosError(409));

    const sha = await provider.uploadFile(Buffer.from('test-content'));

    expect(sha).toBeTruthy();
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutCalls).toEqual([]);
  });

  it('succeeds on first attempt without retry delay', async () => {
    axiosPostSpy.mockResolvedValueOnce({ status: 200, data: {} });

    const sha = await provider.uploadFile(Buffer.from('test-content'));

    expect(sha).toBeTruthy();
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutCalls).toEqual([]);
  });
});
