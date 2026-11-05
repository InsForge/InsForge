import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { helmetMiddleware } from '../../src/api/middlewares/helmet.js';

/**
 * Regression test for issue #1895 (Missing HTTP Security Headers): API
 * responses previously carried none of Helmet's defensive headers.
 *
 * Imports the real `helmetMiddleware` server.ts wires into `createApp()`
 * (backend/src/api/middlewares/helmet.ts) rather than re-deriving the
 * config here — a hand-duplicated copy would keep passing even if the real
 * one drifted or regressed.
 */
function buildApp() {
  const app = express();
  app.use(helmetMiddleware);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('Helmet security headers', () => {
  it('sets the standard defensive headers', async () => {
    const res = await request(buildApp()).get('/ping');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
  });

  it('does not set a CSP, cross-origin-resource-policy, or X-Frame-Options header (deliberately disabled)', async () => {
    const res = await request(buildApp()).get('/ping');

    // Disabled on purpose: the dashboard SPA and client-embedded content
    // aren't compatible with Helmet's default CSP, storage/API responses are
    // deliberately fetched cross-origin by client apps, and the dashboard is
    // deliberately embeddable in a cloud-hosting partner's cross-origin
    // parent iframe (X-Frame-Options: SAMEORIGIN would block that).
    expect(res.headers['content-security-policy']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBeUndefined();
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('allows the cloud-hosting window.opener bridge (same-origin-allow-popups)', async () => {
    const res = await request(buildApp()).get('/ping');

    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });
});
