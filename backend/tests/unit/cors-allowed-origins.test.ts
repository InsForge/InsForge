/**
 * Tests for CORS origin handling (CORS_ALLOWED_ORIGINS).
 *
 *  - unset / `*`: request Origin is reflected (historical behaviour, keeps SDK
 *    apps on arbitrary origins working)
 *  - explicit list: only listed origins receive Access-Control-Allow-Origin
 *    with credentials; others get no CORS headers at all
 *  - requests without an Origin header are unaffected
 */
import express from 'express';
import cors from 'cors';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import {
  parseCorsAllowedOrigins,
  isOriginAllowed,
  buildCorsOriginOption,
  normalizeOrigin,
} from '../../src/utils/cors.js';

function buildApp(allowed: string[] | undefined) {
  const app = express();
  app.use(cors({ origin: buildCorsOriginOption(allowed), credentials: true }));
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('parseCorsAllowedOrigins', () => {
  it('returns undefined (reflect) for unset, empty, whitespace or wildcard', () => {
    expect(parseCorsAllowedOrigins(undefined)).toBeUndefined();
    expect(parseCorsAllowedOrigins('')).toBeUndefined();
    expect(parseCorsAllowedOrigins('  , ')).toBeUndefined();
    expect(parseCorsAllowedOrigins('*')).toBeUndefined();
    expect(parseCorsAllowedOrigins('https://a.com, *')).toBeUndefined();
  });

  it('normalizes entries to lower-case scheme://host[:port] and dedupes', () => {
    expect(
      parseCorsAllowedOrigins(
        ' https://App.Example.com/ , http://localhost:7131,https://app.example.com/path?x=1 '
      )
    ).toEqual(['https://app.example.com', 'http://localhost:7131']);
  });

  it('keeps unparsable entries verbatim so typos fail closed', () => {
    expect(parseCorsAllowedOrigins('not a url')).toEqual(['not a url']);
    expect(normalizeOrigin('not a url')).toBe('not a url');
  });
});

describe('isOriginAllowed', () => {
  it('allows everything when no list is configured', () => {
    expect(isOriginAllowed('https://evil.com', undefined)).toBe(true);
    expect(isOriginAllowed(undefined, undefined)).toBe(true);
  });

  it('allows absent Origin (non-browser callers) with a list configured', () => {
    expect(isOriginAllowed(undefined, ['https://app.example.com'])).toBe(true);
  });

  it('matches listed origins exactly (case-insensitive host) and rejects others', () => {
    const list = ['https://app.example.com', 'http://localhost:7131'];
    expect(isOriginAllowed('https://app.example.com', list)).toBe(true);
    expect(isOriginAllowed('https://APP.example.com', list)).toBe(true);
    expect(isOriginAllowed('http://localhost:7131', list)).toBe(true);
    expect(isOriginAllowed('http://localhost:7130', list)).toBe(false);
    expect(isOriginAllowed('https://app.example.com.evil.com', list)).toBe(false);
    expect(isOriginAllowed('https://evil.com', list)).toBe(false);
    expect(isOriginAllowed('null', list)).toBe(false);
  });
});

describe('cors middleware with buildCorsOriginOption', () => {
  it('reflects any origin with credentials when no allow-list is set', async () => {
    const res = await request(buildApp(undefined)).get('/ping').set('Origin', 'https://any.site');
    expect(res.headers['access-control-allow-origin']).toBe('https://any.site');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('only emits CORS headers for listed origins', async () => {
    const app = buildApp(['https://app.example.com']);

    const ok = await request(app).get('/ping').set('Origin', 'https://app.example.com');
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(app).get('/ping').set('Origin', 'https://evil.com');
    expect(denied.status).toBe(200); // request still served; browser blocks the response
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(denied.headers['access-control-allow-credentials']).toBeUndefined();

    const preflight = await request(app)
      .options('/ping')
      .set('Origin', 'https://evil.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves requests without an Origin header normally', async () => {
    const res = await request(buildApp(['https://app.example.com'])).get('/ping');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
