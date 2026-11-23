/**
 * Tests for the legacy `/functions/:slug` invoke proxy.
 *
 * Covers:
 *  - a slug that is not a slug (`//evil.com`, `../x`) is rejected before any
 *    upstream request is made (SSRF via Express decoding `%2F` in params)
 *  - cookies and hop-by-hop headers are not forwarded to the function host
 *  - authorization / x-api-key are forwarded (functions act for the caller)
 *  - query string and method are preserved, response body/status pass through
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Response as FetchResponse } from 'node-fetch';

vi.mock('../../src/services/functions/function.service.js', () => ({
  FunctionService: { getInstance: () => ({ isSubhostingConfigured: () => false }) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createFunctionInvokeProxy,
  buildProxyRequestHeaders,
  resolveFunctionTargetUrl,
} from '../../src/api/routes/functions/invoke-proxy.js';

const BASE_URL = 'http://functions.internal:7133';

function buildApp(fetchImpl: ReturnType<typeof vi.fn>) {
  const app = express();
  app.use(express.json());
  app.all(
    '/functions/:slug',
    createFunctionInvokeProxy({
      fetchImpl: fetchImpl as unknown as typeof import('node-fetch').default,
      getBaseUrl: async () => BASE_URL,
    })
  );
  return app;
}

describe('resolveFunctionTargetUrl', () => {
  it('builds the upstream URL on the function host for a valid slug', () => {
    const url = resolveFunctionTargetUrl('hello-world', BASE_URL, '?a=1');
    expect(url.href).toBe(`${BASE_URL}/hello-world?a=1`);
  });

  it.each(['//evil.com', '//169.254.169.254/latest', '../admin', 'a/b', '', 'x y', 'héllo'])(
    'rejects non-slug path segment %j',
    (slug) => {
      expect(() => resolveFunctionTargetUrl(slug, BASE_URL, '')).toThrow(/Invalid function slug/);
    }
  );
});

describe('buildProxyRequestHeaders', () => {
  it('drops cookie and hop-by-hop headers, keeps authorization, rewrites host', () => {
    const headers = buildProxyRequestHeaders(
      {
        host: 'api.example.com',
        cookie: 'insforge_refresh_token=secret',
        Cookie: 'other=1',
        authorization: 'Bearer user-token',
        'x-api-key': 'ik_test',
        'content-type': 'application/json',
        'content-length': '42',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
        'x-forwarded-for': ['1.1.1.1', '2.2.2.2'] as unknown as string,
      },
      'functions.internal:7133'
    );

    expect(headers).toEqual({
      authorization: 'Bearer user-token',
      'x-api-key': 'ik_test',
      'content-type': 'application/json',
      host: 'functions.internal:7133',
    });
  });
});

describe('/functions/:slug proxy handler', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new FetchResponse(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { 'content-type': 'application/json', 'x-upstream': 'yes' },
        })
    );
  });

  it('returns 404 and never calls upstream for an encoded host-rewriting slug', async () => {
    const app = buildApp(fetchMock);
    for (const path of [
      '/functions/%2F%2Fevil.com',
      '/functions/%2F%2F169.254.169.254%2Flatest%2Fmeta-data',
      '/functions/..%2F..%2Fadmin',
      '/functions/hello%20world',
    ]) {
      const res = await request(app).get(path).set('authorization', 'Bearer t');
      expect(res.status, path).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a valid slug to the function host, preserving method and query', async () => {
    const app = buildApp(fetchMock);
    const res = await request(app)
      .post('/functions/hello-world?x=1&y=2')
      .set('authorization', 'Bearer user-token')
      .set('cookie', 'insforge_refresh_token=secret; insforge_admin_refresh_token=adm')
      .send({ name: 'John' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['x-upstream']).toBe('yes');
    expect(res.headers['access-control-allow-origin']).toBe('*');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      URL,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url.href).toBe(`${BASE_URL}/hello-world?x=1&y=2`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'John' }));
    expect(init.headers.authorization).toBe('Bearer user-token');
    expect(init.headers.host).toBe('functions.internal:7133');
    expect(Object.keys(init.headers).map((k) => k.toLowerCase())).not.toContain('cookie');
  });

  it('returns 502 when the upstream call fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const app = buildApp(fetchMock);
    const res = await request(app).get('/functions/hello-world');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/ECONNREFUSED/);
  });
});
