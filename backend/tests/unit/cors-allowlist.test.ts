import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for issue #1895 (Over-Permissive CORS Configuration):
 * `cors({ origin: true, credentials: true })` reflected any Origin header and
 * allowed credentialed cross-origin requests from it, so any website could
 * make authenticated calls against this API using a visitor's cookies.
 */

const authConfigMock = vi.hoisted(() => ({ getAuthConfig: vi.fn() }));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: { getInstance: () => authConfigMock },
}));

vi.mock('../../src/utils/environment.js', () => ({
  getApiBaseUrl: () => 'https://api.example.com',
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

async function buildApp() {
  vi.resetModules();
  const { corsMiddleware } = await import('../../src/api/middlewares/cors.js');
  const app = express();
  app.use(corsMiddleware);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('corsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the API base origin', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({ allowedRedirectUrls: [] });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://api.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://api.example.com');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows any origin when no allowlist is configured (unchanged default)', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({ allowedRedirectUrls: [] });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://anything.example');

    expect(res.headers['access-control-allow-origin']).toBe('https://anything.example');
  });

  it('rejects an origin not covered by a configured allowlist', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({
      allowedRedirectUrls: ['https://app.example.com/auth/callback'],
    });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows an origin matching a configured allowlist entry', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({
      allowedRedirectUrls: ['https://app.example.com/auth/callback'],
    });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
  });

  it('allows a subdomain-wildcard allowlist entry', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({
      allowedRedirectUrls: ['https://*.example.com/**'],
    });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://tenant.example.com');

    expect(res.headers['access-control-allow-origin']).toBe('https://tenant.example.com');
  });

  it('rejects a scheme mismatch against an otherwise-matching host', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({
      allowedRedirectUrls: ['https://app.example.com/callback'],
    });
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'http://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests without an Origin header through (non-browser clients)', async () => {
    authConfigMock.getAuthConfig.mockResolvedValue({
      allowedRedirectUrls: ['https://app.example.com/callback'],
    });
    const app = await buildApp();

    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
  });

  it('fails closed (relative to a configured allowlist) if the config lookup errors', async () => {
    authConfigMock.getAuthConfig.mockRejectedValue(new Error('db down'));
    const app = await buildApp();

    const res = await request(app).get('/ping').set('Origin', 'https://app.example.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves a stale allowlist without hitting the DB again on every request during an outage', async () => {
    authConfigMock.getAuthConfig.mockResolvedValueOnce({
      allowedRedirectUrls: ['https://app.example.com/callback'],
    });
    const app = await buildApp();

    // Prime the cache with a successful fetch.
    await request(app).get('/ping').set('Origin', 'https://app.example.com');
    expect(authConfigMock.getAuthConfig).toHaveBeenCalledTimes(1);

    // Force the cache to look expired, then start failing — mirroring a DB
    // outage that lasts past the TTL.
    authConfigMock.getAuthConfig.mockRejectedValue(new Error('db down'));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31_000);

    const first = await request(app).get('/ping').set('Origin', 'https://app.example.com');
    const second = await request(app).get('/ping').set('Origin', 'https://app.example.com');

    vi.useRealTimers();

    // Both requests should still be allowed (serving the stale list), and the
    // failed refresh should only have been attempted once — the catch branch
    // must re-arm the TTL, not leave every subsequent request re-entering the
    // stale-cache branch and re-issuing a doomed DB read.
    expect(first.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(second.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(authConfigMock.getAuthConfig).toHaveBeenCalledTimes(2);
  });
});

describe('originMatchesPattern', () => {
  it('matches exact origins case-insensitively', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('https://App.Example.com', 'https://app.example.com')).toBe(true);
  });

  it('matches a leading subdomain wildcard', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('https://*.example.com', 'https://a.b.example.com')).toBe(true);
    expect(originMatchesPattern('https://*.example.com', 'https://example.com')).toBe(false);
  });

  it('matches a wildcard placed mid-host, not just as a leading subdomain', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('https://*foo.example.com', 'https://barfoo.example.com')).toBe(
      true
    );
    expect(originMatchesPattern('https://*foo.example.com', 'https://foobar.example.com')).toBe(
      false
    );
  });

  it('rejects a non-default port mismatch', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('https://example.com:8443', 'https://example.com')).toBe(false);
  });

  it('matches when a pattern spells out the scheme default port explicitly', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('https://app.example.com:443', 'https://app.example.com')).toBe(
      true
    );
    expect(originMatchesPattern('http://app.example.com:80', 'http://app.example.com')).toBe(true);
  });

  it('rejects an unparseable pattern', async () => {
    const { originMatchesPattern } = await import('../../src/api/middlewares/cors.js');
    expect(originMatchesPattern('not-a-url', 'https://example.com')).toBe(false);
  });
});
