import { Readable } from 'stream';
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

function makeAxiosError(status: number): AxiosError {
  const error = new Error(`Request failed with status code ${status}`) as AxiosError;
  error.isAxiosError = true;
  error.response = {
    status,
    statusText: status === 429 ? 'Too Many Requests' : 'Request Failed',
    headers: {},
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

  it('limits concurrency to 10 at a time', async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    await provider.uploadFiles(files);

    expect(peakConcurrent).toBeLessThanOrEqual(10);
    expect(peakConcurrent).toBeGreaterThan(1); // still parallel within a batch
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

  it('handles exactly one batch (10 files)', async () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `file-${i}.txt`,
      content: Buffer.from(`content-${i}`),
    }));

    const results = await provider.uploadFiles(files);

    expect(results).toHaveLength(10);
    expect(peakConcurrent).toBeLessThanOrEqual(10);
  });

  it('propagates upload errors without swallowing them', async () => {
    uploadFileSpy.mockRejectedValueOnce(new Error('rate limited'));

    const files = [{ path: 'fail.txt', content: Buffer.from('fail') }];

    await expect(provider.uploadFiles(files)).rejects.toThrow('rate limited');
  });
});

describe('VercelProvider.uploadFileStream', () => {
  let provider: VercelProvider;
  let axiosPostSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Reset singleton for clean tests
    // @ts-expect-error accessing private static for test reset
    VercelProvider.instance = undefined;
    provider = VercelProvider.getInstance();

    vi.spyOn(provider, 'getCredentials').mockResolvedValue({
      token: 'test-token',
      teamId: 'test-team',
      projectId: 'test-project',
      expiresAt: null,
      slug: null,
    });

    axiosPostSpy = vi.spyOn(axios, 'post');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams file content with Vercel digest headers', async () => {
    axiosPostSpy.mockResolvedValueOnce({ status: 200, data: {} });

    const content = Readable.from([Buffer.from('hello')]);
    const sha = 'a'.repeat(40);
    const abortController = new AbortController();
    const result = await provider.uploadFileStream({
      content,
      sha,
      size: 5,
      signal: abortController.signal,
    });

    expect(result).toBe(sha);
    expect(axiosPostSpy).toHaveBeenCalledWith(
      'https://api.vercel.com/v2/files?teamId=test-team',
      content,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/octet-stream',
          'Content-Length': '5',
          'x-vercel-digest': sha,
        }),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        signal: abortController.signal,
      })
    );
  });

  it('treats existing streamed files as success', async () => {
    axiosPostSpy.mockRejectedValueOnce(makeAxiosError(409));

    const sha = 'b'.repeat(40);
    const result = await provider.uploadFileStream({
      content: Readable.from([Buffer.from('hello')]),
      sha,
      size: 5,
    });

    expect(result).toBe(sha);
    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry rate-limited streamed uploads', async () => {
    axiosPostSpy.mockRejectedValueOnce(makeAxiosError(429));

    await expect(
      provider.uploadFileStream({
        content: Readable.from([Buffer.from('hello')]),
        sha: 'c'.repeat(40),
        size: 5,
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    });

    expect(axiosPostSpy).toHaveBeenCalledTimes(1);
  });

  it('maps Vercel digest rejection to invalid input', async () => {
    axiosPostSpy.mockRejectedValueOnce(makeAxiosError(400));

    await expect(
      provider.uploadFileStream({
        content: Readable.from([Buffer.from('hello')]),
        sha: 'd'.repeat(40),
        size: 5,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
  });
});
