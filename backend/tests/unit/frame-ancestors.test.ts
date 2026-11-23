import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';

/**
 * Regression test for the clickjacking regression flagged on top of issue
 * #1895's Helmet hardening: disabling `frameguard` outright (to allow the
 * cloud-hosting partner's cross-origin iframe embed) let *any* origin frame
 * the dashboard. This middleware restores real protection via a scoped
 * `frame-ancestors` CSP directive instead.
 *
 * Also covers two follow-up review findings:
 *   - the middleware is mounted globally ahead of every route (including
 *     health checks), so it must never block a request on the outbound
 *     fetch to config.insforge.dev — it serves from cache synchronously and
 *     refreshes in the background.
 *   - a cold process's first request (which may be the partner's own
 *     iframe load) must not race that background fetch and get stuck with
 *     a 'self'-only policy — `warmPartnerOriginsCache()` is awaited before
 *     the app accepts connections (server.ts) to prevent that.
 *
 * The middleware caches the fetched partner-origin list at module scope, so
 * each test resets the module registry and re-imports it fresh — otherwise
 * the first test's cached result would leak into later tests within the
 * TTL window.
 */
async function loadModule() {
  vi.resetModules();
  return (await import('../../src/api/middlewares/frame-ancestors.js')) as {
    frameAncestorsMiddleware: RequestHandler;
    warmPartnerOriginsCache: () => Promise<void>;
  };
}

async function buildApp() {
  const { frameAncestorsMiddleware } = await loadModule();
  const app = express();
  app.use(frameAncestorsMiddleware);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('frame-ancestors middleware', () => {
  // Each test calls vi.resetModules() and dynamically re-imports the module
  // under test, which re-transpiles it every time; the default 10s per-test
  // timeout can be tight under that overhead, so give these a bit more room.
  vi.setConfig({ testTimeout: 20_000 });

  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('defaults to self only on the very first request, before any fetch has completed', async () => {
    // A fetch that never resolves within the test: proves the response
    // does not wait on it.
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})) as unknown as typeof fetch;

    const res = await request(await buildApp()).get('/ping');

    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
  });

  it('includes partner origins from the partnership config once a background fetch resolves', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ partner_sites: ['https://partner.example.com/embed'] }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    // First request triggers the background fetch (and gets 'self' only,
    // since it hasn't resolved yet); wait for it, then request again.
    await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    const res = await request(app).get('/ping');

    expect(res.headers['content-security-policy']).toBe(
      "frame-ancestors 'self' https://partner.example.com"
    );
  });

  it('ignores malformed entries in partner_sites instead of failing the whole policy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ partner_sites: ['not-a-valid-url', 'https://good.example.com'] }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    const res = await request(app).get('/ping');

    expect(res.headers['content-security-policy']).toBe(
      "frame-ancestors 'self' https://good.example.com"
    );
  });

  it('degrades to self only, without throwing, when the fetch rejects and nothing was cached yet', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const app = await buildApp();
    const firstRes = await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    const secondRes = await request(app).get('/ping');

    expect(firstRes.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    expect(secondRes.headers['content-security-policy']).toBe("frame-ancestors 'self'");
  });

  it('degrades to self only when the config endpoint responds with a non-ok HTTP status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch;

    const app = await buildApp();
    await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    const res = await request(app).get('/ping');

    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'self'");
  });

  it('keeps serving the last known-good partner list when a later refresh fails', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ partner_sites: ['https://partner.example.com'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { frameAncestorsMiddleware, warmPartnerOriginsCache } = await loadModule();
    await warmPartnerOriginsCache();
    const app = express();
    app.use(frameAncestorsMiddleware);
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    const goodRes = await request(app).get('/ping');
    expect(goodRes.headers['content-security-policy']).toBe(
      "frame-ancestors 'self' https://partner.example.com"
    );

    // A later refresh (simulated directly, since the TTL is 30s and this
    // test doesn't fast-forward real time) fails — the cache should keep
    // serving the last known-good list rather than dropping it.
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await warmPartnerOriginsCache();

    const staleRes = await request(app).get('/ping');
    expect(staleRes.headers['content-security-policy']).toBe(
      "frame-ancestors 'self' https://partner.example.com"
    );
  });

  it('does not re-fetch within the TTL window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ partner_sites: ['https://partner.example.com'] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const app = await buildApp();
    await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    await request(app).get('/ping');
    await request(app).get('/ping');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches an empty result on failure too, so a sustained outage does not re-fetch on every request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
    global.fetch = fetchMock as unknown as typeof fetch;

    const app = await buildApp();
    await request(app).get('/ping');
    await new Promise((resolve) => setImmediate(resolve));
    await request(app).get('/ping');
    await request(app).get('/ping');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warmPartnerOriginsCache populates the cache before any request arrives', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ partner_sites: ['https://partner.example.com'] }),
    }) as unknown as typeof fetch;

    const { frameAncestorsMiddleware, warmPartnerOriginsCache } = await loadModule();
    await warmPartnerOriginsCache();

    const app = express();
    app.use(frameAncestorsMiddleware);
    app.get('/ping', (_req, res) => res.json({ ok: true }));

    // No 'setImmediate' wait needed: the cache is already warm from the
    // awaited warmPartnerOriginsCache() call above, so even the very first
    // request sees the partner origin.
    const res = await request(app).get('/ping');
    expect(res.headers['content-security-policy']).toBe(
      "frame-ancestors 'self' https://partner.example.com"
    );
  });
});
