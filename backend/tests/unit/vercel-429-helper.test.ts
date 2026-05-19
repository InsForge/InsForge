import { describe, it, expect, vi, afterEach } from 'vitest';
import { withVercelRateLimitRetry } from '@/providers/deployments/vercel.provider.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';

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

  it('throws AppError(429, RATE_LIMITED) after exhausting retries', async () => {
    const op = vi.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = new Error('429');
      err.isAxiosError = true;
      err.response = { status: 429, headers: {} };
      throw err;
    });

    let caught: unknown;
    try {
      await withVercelRateLimitRetry(op, {
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitterMaxMs: 1,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(429);
    expect((caught as AppError).code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(op).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe('withVercelRateLimitRetry — delay clamping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('clamps the final delay (base + jitter) at maxDelayMs', async () => {
    // Capture every setTimeout delay the helper requests, then run cb sync so
    // the test does not actually wait. We can then assert the requested
    // delays never exceed maxDelayMs even with maximal jitter.
    const recordedDelays: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation(((
      cb: (...args: unknown[]) => void,
      ms?: number
    ) => {
      recordedDelays.push(ms ?? 0);
      cb();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
    // Force jitter to its maximum so it cannot mask the clamp bug.
    vi.spyOn(Math, 'random').mockReturnValue(0.999_999);

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

    const opts = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 200, jitterMaxMs: 1000 };
    await withVercelRateLimitRetry(op, opts);

    expect(recordedDelays.length).toBeGreaterThan(0);
    for (const d of recordedDelays) {
      expect(d).toBeLessThanOrEqual(opts.maxDelayMs);
    }
  });
});
