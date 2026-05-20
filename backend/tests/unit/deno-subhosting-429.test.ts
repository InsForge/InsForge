import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Response } from 'node-fetch';

// Helper to make a JSON response that node-fetch will accept.
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Deno Subhosting 429 backoff', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DENO_SUBHOSTING_TOKEN = 't';
    process.env.DENO_SUBHOSTING_ORG_ID = 'o';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('node-fetch');
    delete process.env.DENO_SUBHOSTING_TOKEN;
    delete process.env.DENO_SUBHOSTING_ORG_ID;
  });

  it('retries on 429 with exponential backoff and eventually succeeds', async () => {
    let attempts = 0;
    vi.doMock('node-fetch', () => ({
      __esModule: true,
      default: vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          return new Response('', { status: 429 });
        }
        return jsonResponse({
          id: 'dep-1',
          projectId: 'proj-1',
          status: 'success',
          domains: [],
          createdAt: new Date().toISOString(),
        });
      }),
      Response,
    }));

    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    const result = await provider.getDeployment('dep-1');
    expect(result).toBeDefined();
    expect(attempts).toBe(3);
  }, 30_000);

  it('honors Retry-After header in seconds', async () => {
    const start = Date.now();
    let attempts = 0;
    vi.doMock('node-fetch', () => ({
      __esModule: true,
      default: vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('', { status: 429, headers: { 'retry-after': '1' } });
        }
        return jsonResponse({
          id: 'dep-2',
          projectId: 'proj-1',
          status: 'success',
          domains: [],
          createdAt: new Date().toISOString(),
        });
      }),
      Response,
    }));

    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    await provider.getDeployment('dep-2');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  }, 30_000);

  it('throws AppError(429, RATE_LIMITED) after exhausting retries', async () => {
    // Pin Math.random so the inner jitter is deterministic — keeps the test
    // free of flakes around timing of the 4 attempts.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    let attempts = 0;
    vi.doMock('node-fetch', () => ({
      __esModule: true,
      default: vi.fn(async () => {
        attempts++;
        return new Response('', { status: 429 });
      }),
      Response,
    }));

    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const { AppError } = await import('@/api/middlewares/error.js');
    const { ERROR_CODES } = await import('@/types/error-constants.js');
    const provider = mod.DenoSubhostingProvider.getInstance();

    // Exhausted retries must surface as 429 RATE_LIMITED, not the generic 500
    // INTERNAL_ERROR that callers would otherwise raise from `!response.ok`.
    await expect(provider.getDeployment('dep-3')).rejects.toMatchObject({
      constructor: AppError,
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
    });
    // initial + 3 retries from DEFAULT_RATE_LIMIT_BACKOFF_MS = 4 attempts
    expect(attempts).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it('caps Retry-After at 30s even when upstream asks for much longer', async () => {
    // Spy on setTimeout to capture every requested delay without actually
    // waiting. The provider also uses setTimeout for its initial fetch
    // timeout; we only care that NO requested delay exceeds the 30s cap.
    const recordedDelays: number[] = [];
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, 'setTimeout').mockImplementation(((
      cb: (...args: unknown[]) => void,
      ms?: number
    ) => {
      recordedDelays.push(ms ?? 0);
      // Run the callback async so abort flows still work, but immediately.
      return realSetTimeout(cb, 0);
    }) as unknown as typeof setTimeout);

    let attempts = 0;
    vi.doMock('node-fetch', () => ({
      __esModule: true,
      default: vi.fn(async () => {
        attempts++;
        if (attempts === 1) {
          // 600 seconds — way beyond the 30s cap.
          return new Response('', { status: 429, headers: { 'retry-after': '600' } });
        }
        return jsonResponse({
          id: 'dep-cap',
          projectId: 'proj-1',
          status: 'success',
          domains: [],
          createdAt: new Date().toISOString(),
        });
      }),
      Response,
    }));

    const mod = await import('@/providers/functions/deno-subhosting.provider.js');
    const provider = mod.DenoSubhostingProvider.getInstance();
    await provider.getDeployment('dep-cap');

    // No delay (timeout or backoff) should ever exceed the 30s cap.
    const MAX_RETRY_AFTER_MS = 30_000;
    for (const d of recordedDelays) {
      expect(d).toBeLessThanOrEqual(MAX_RETRY_AFTER_MS);
    }
  }, 30_000);
});

describe('parseRetryAfterMs', () => {
  it('parses integer seconds into ms', async () => {
    const { parseRetryAfterMs } = await import('@/providers/functions/deno-subhosting.provider.js');
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs(' 12 ')).toBe(12_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses HTTP-date as delta from now', async () => {
    const { parseRetryAfterMs } = await import('@/providers/functions/deno-subhosting.provider.js');
    const future = new Date(Date.now() + 5000).toUTCString();
    const delta = parseRetryAfterMs(future);
    // Allow some slop for clock movement during the test.
    expect(delta).toBeGreaterThanOrEqual(4000);
    expect(delta).toBeLessThanOrEqual(6000);
  });

  it('clamps a past HTTP-date at 0', async () => {
    const { parseRetryAfterMs } = await import('@/providers/functions/deno-subhosting.provider.js');
    const past = new Date(Date.now() - 60_000).toUTCString();
    expect(parseRetryAfterMs(past)).toBe(0);
  });

  it('returns NaN for null, empty, or unparseable input', async () => {
    const { parseRetryAfterMs } = await import('@/providers/functions/deno-subhosting.provider.js');
    expect(parseRetryAfterMs(null)).toBeNaN();
    expect(parseRetryAfterMs('')).toBeNaN();
    expect(parseRetryAfterMs('not-a-date')).toBeNaN();
  });
});
