import { describe, it, expect, vi } from 'vitest';
import { withVercelRateLimitRetry } from '@/providers/deployments/vercel.provider.js';

describe('withVercelRateLimitRetry', () => {
  it('retries on 429 honoring X-RateLimit-Reset (unix seconds)', async () => {
    const reset = Math.floor(Date.now() / 1000) + 1; // ~1s in the future
    let attempts = 0;
    const op = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('429');
        err.isAxiosError = true;
        err.response = { status: 429, headers: { 'x-ratelimit-reset': String(reset) } };
        throw err;
      }
      return { id: 'ok' };
    });

    const result = await withVercelRateLimitRetry(op, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      jitterMaxMs: 50,
    });
    expect(result).toEqual({ id: 'ok' });
    expect(attempts).toBe(2);
  });

  it('falls back to exponential backoff when X-RateLimit-Reset is missing', async () => {
    let attempts = 0;
    const op = vi.fn(async () => {
      attempts++;
      if (attempts < 3) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = new Error('429');
        err.isAxiosError = true;
        err.response = { status: 429, headers: {} };
        throw err;
      }
      return { id: 'ok' };
    });

    const result = await withVercelRateLimitRetry(op, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 100,
      jitterMaxMs: 1,
    });
    expect(result).toEqual({ id: 'ok' });
    expect(attempts).toBe(3);
  });

  it('rethrows non-429 errors immediately', async () => {
    const op = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('boom');
      err.isAxiosError = true;
      err.response = { status: 500 };
      throw err;
    });

    await expect(
      withVercelRateLimitRetry(op, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, jitterMaxMs: 1 })
    ).rejects.toThrow('boom');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries', async () => {
    const op = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('429');
      err.isAxiosError = true;
      err.response = { status: 429, headers: {} };
      throw err;
    });

    await expect(
      withVercelRateLimitRetry(op, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, jitterMaxMs: 1 })
    ).rejects.toThrow('429');
    expect(op).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
