import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VercelProvider } from '../../src/providers/deployments/vercel.provider';

// Mock dependencies so we don't hit real APIs
vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => false,
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

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
