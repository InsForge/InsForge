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

  it('throws after exhausting retries', async () => {
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
    const provider = mod.DenoSubhostingProvider.getInstance();

    await expect(provider.getDeployment('dep-3')).rejects.toThrow();
    // initial + 3 retries from DEFAULT_RATE_LIMIT_BACKOFF_MS = 4 attempts
    expect(attempts).toBeGreaterThanOrEqual(4);
  }, 30_000);
});
