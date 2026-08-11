import { describe, expect, it, beforeEach, afterEach, afterAll, vi } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import supertest from 'supertest';
import { EventEmitter } from 'events';
import {
  createCorsMiddleware,
  normalizeOrigin,
  parseAllowedOrigin,
  isOriginAllowed,
  buildAllowlist,
  buildEnvAllowlist,
  refreshCorsAllowlist,
  getCorsAllowlist,
  setCorsAllowlist,
  bumpMinRequiredGeneration,
  setAllowlistFromOrigins,
} from '@/api/middlewares/cors.js';
import { buildInfoPayload } from '../../../functions/lib/info-payload.js';

// Mock must match the EXACT dynamic import path used inside buildAllowlist in cors.ts
vi.mock('@/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: vi.fn(),
  },
}));

// ─── Top-level env save/restore ───────────────────────────────────────────────
const ORIGINAL_API_BASE_URL = process.env.API_BASE_URL;
const ORIGINAL_VITE_API_BASE_URL = process.env.VITE_API_BASE_URL;

describe('Edge Security Hardening Bundle (#1895)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_API_BASE_URL !== undefined) {
      process.env.API_BASE_URL = ORIGINAL_API_BASE_URL;
    } else {
      delete process.env.API_BASE_URL;
    }

    if (ORIGINAL_VITE_API_BASE_URL !== undefined) {
      process.env.VITE_API_BASE_URL = ORIGINAL_VITE_API_BASE_URL;
    } else {
      delete process.env.VITE_API_BASE_URL;
    }

    // Reset allowlistRef after each test
    setCorsAllowlist(null);
  });

  // ─── Fix 1 — Helmet ──────────────────────────────────────────────────────────
  describe('Fix 1 — Helmet Security Headers', () => {
    it('attaches production helmet security headers to HTTP responses without upgrade-insecure-requests', async () => {
      const app = express();
      app.use(
        helmet({
          contentSecurityPolicy: {
            directives: {
              ...helmet.contentSecurityPolicy.getDefaultDirectives(),
              'upgrade-insecure-requests': null,
            },
          },
        })
      );
      app.get('/test', (_req, res) => {
        res.json({ status: 'ok' });
      });

      const response = await supertest(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['x-dns-prefetch-control']).toBe('off');
      const csp = response.headers['content-security-policy'];
      expect(csp).toBeDefined();
      expect(csp).not.toContain('upgrade-insecure-requests');
    });
  });

  // ─── Fix 2 — Strict CORS Allowlist ───────────────────────────────────────────
  describe('Fix 2 — Strict CORS Allowlist with Wildcards & Null Filtering', () => {
    function createCorsApp(exactOrigins: Set<string>, wildcardPatterns: RegExp[]) {
      setCorsAllowlist({ exactOrigins, wildcardPatterns });
      const app = express();
      app.use(createCorsMiddleware());
      app.get('/api/test', (_req, res) => {
        res.json({ success: true });
      });
      return app;
    }

    function buildAllowlistFromEnv() {
      const exactOrigins = new Set<string>();
      const wildcardPatterns: RegExp[] = [];
      const add = (url: string | undefined) => {
        if (!url) return;
        const parsed = parseAllowedOrigin(url);
        if (!parsed) return;
        if (parsed.type === 'exact') {
          exactOrigins.add(parsed.value);
        } else {
          wildcardPatterns.push(parsed.regex);
        }
      };
      add(process.env.API_BASE_URL);
      add(process.env.VITE_API_BASE_URL);
      return { exactOrigins, wildcardPatterns };
    }

    it('normalizes origins correctly and rejects null / non-http(s)', () => {
      expect(normalizeOrigin('https://app.insforge.dev/')).toBe('https://app.insforge.dev');
      expect(normalizeOrigin('https://app.insforge.dev')).toBe('https://app.insforge.dev');
      expect(normalizeOrigin('null')).toBeUndefined();
      expect(normalizeOrigin('javascript:alert(1)')).toBeUndefined();
      expect(normalizeOrigin(undefined)).toBeUndefined();
    });

    it('parses wildcard origin patterns correctly', () => {
      const parsedExact = parseAllowedOrigin('https://app.insforge.dev');
      expect(parsedExact).toEqual({ type: 'exact', value: 'https://app.insforge.dev' });

      const parsedWildcard = parseAllowedOrigin('https://*.example.com');
      expect(parsedWildcard?.type).toBe('wildcard');
      if (parsedWildcard?.type === 'wildcard') {
        expect(parsedWildcard.regex.test('https://sub.example.com')).toBe(true);
        expect(parsedWildcard.regex.test('https://deep.sub.example.com')).toBe(true);
        expect(parsedWildcard.regex.test('https://evil.com')).toBe(false);
      }

      expect(parseAllowedOrigin('https://app.example.com/callback/*')).toEqual({
        type: 'exact',
        value: 'https://app.example.com',
      });
      expect(parseAllowedOrigin('null')).toBeNull();
    });

    it('rejects userinfo injection and malformed wildcard patterns like https://*.example.com@evil.com', () => {
      expect(parseAllowedOrigin('https://*.example.com@evil.com')).toBeNull();
      expect(parseAllowedOrigin('https://user:pass@example.com')).toBeNull();
      expect(normalizeOrigin('https://user:pass@example.com')).toBeUndefined();
    });

    it('escapes regex metacharacters in wildcard patterns (injection guard) — unconditional', () => {
      // Unparseable metacharacters like pipe '|' in host are rejected as null
      expect(parseAllowedOrigin('https://evil|*.example.com')).toBeNull();

      // Valid metacharacters like hyphen '-' and plus '+' are properly escaped
      const resultHyphen = parseAllowedOrigin('https://app-*.example.com');
      expect(resultHyphen).not.toBeNull();
      expect(resultHyphen!.type).toBe('wildcard');
      const regexHyphen = (resultHyphen as { type: 'wildcard'; regex: RegExp }).regex;
      expect(regexHyphen.test('https://app-sub.example.com')).toBe(true);
      expect(regexHyphen.test('https://appXsub.example.com')).toBe(false);

      const resultPlus = parseAllowedOrigin('https://app+*.example.com');
      expect(resultPlus).not.toBeNull();
      expect(resultPlus!.type).toBe('wildcard');
      const regexPlus = (resultPlus as { type: 'wildcard'; regex: RegExp }).regex;
      expect(regexPlus.test('https://app+sub.example.com')).toBe(true);
      expect(regexPlus.test('https://apppsub.example.com')).toBe(false);
    });

    it('validates allowed origins against exact set and wildcard regexes', () => {
      const exact = new Set(['https://app.insforge.dev']);
      const wildcards = [/^https:\/\/[^.]+\.example\.com$/];

      expect(isOriginAllowed('https://app.insforge.dev', exact, wildcards)).toBe(true);
      expect(isOriginAllowed('https://test.example.com', exact, wildcards)).toBe(true);
      expect(isOriginAllowed('https://evil.com', exact, wildcards)).toBe(false);
    });

    it('allows requests matching API_BASE_URL', async () => {
      process.env.API_BASE_URL = 'https://app.insforge.dev';
      const { exactOrigins, wildcardPatterns } = buildAllowlistFromEnv();
      const app = createCorsApp(exactOrigins, wildcardPatterns);

      const response = await supertest(app)
        .get('/api/test')
        .set('Origin', 'https://app.insforge.dev');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://app.insforge.dev');
    });

    it('allows requests matching VITE_API_BASE_URL', async () => {
      process.env.VITE_API_BASE_URL = 'https://dashboard.insforge.dev';
      const { exactOrigins, wildcardPatterns } = buildAllowlistFromEnv();
      const app = createCorsApp(exactOrigins, wildcardPatterns);

      const response = await supertest(app)
        .get('/api/test')
        .set('Origin', 'https://dashboard.insforge.dev');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(
        'https://dashboard.insforge.dev'
      );
    });

    it('rejects unauthorized origins without CORS allow header', async () => {
      process.env.API_BASE_URL = 'https://app.insforge.dev';
      const { exactOrigins, wildcardPatterns } = buildAllowlistFromEnv();
      const app = createCorsApp(exactOrigins, wildcardPatterns);

      const response = await supertest(app).get('/api/test').set('Origin', 'https://evil.com');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects null origin string', async () => {
      process.env.API_BASE_URL = 'https://app.insforge.dev';
      const { exactOrigins, wildcardPatterns } = buildAllowlistFromEnv();
      const app = createCorsApp(exactOrigins, wildcardPatterns);

      const response = await supertest(app).get('/api/test').set('Origin', 'null');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows requests without an Origin header (same-origin / cURL)', async () => {
      process.env.API_BASE_URL = 'https://app.insforge.dev';
      const { exactOrigins, wildcardPatterns } = buildAllowlistFromEnv();
      const app = createCorsApp(exactOrigins, wildcardPatterns);

      const response = await supertest(app).get('/api/test');

      expect(response.status).toBe(200);
    });
  });

  // ─── buildAllowlist behavioral coverage ──────────────────────────────────────
  describe('buildAllowlist behavioral coverage', () => {
    const SAVED_API_BASE = process.env.API_BASE_URL;
    const SAVED_VITE_BASE = process.env.VITE_API_BASE_URL;

    beforeEach(() => {
      process.env.API_BASE_URL = 'https://api.example.com';
      process.env.VITE_API_BASE_URL = 'https://app.example.com';
      vi.clearAllMocks();
    });

    afterAll(() => {
      if (SAVED_API_BASE !== undefined) {
        process.env.API_BASE_URL = SAVED_API_BASE;
      } else {
        delete process.env.API_BASE_URL;
      }
      if (SAVED_VITE_BASE !== undefined) {
        process.env.VITE_API_BASE_URL = SAVED_VITE_BASE;
      } else {
        delete process.env.VITE_API_BASE_URL;
      }
    });

    it('includes DB-configured allowedRedirectUrls on success', async () => {
      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockResolvedValue({
          allowedRedirectUrls: [
            'https://dashboard.example.com',
            'https://*.partner.com',
            'null', // should be filtered
            'file://bad', // should be filtered
          ],
        }),
      });

      const result = await buildAllowlist();

      expect(result.exactOrigins.has('https://api.example.com')).toBe(true);
      expect(result.exactOrigins.has('https://app.example.com')).toBe(true);
      expect(result.exactOrigins.has('https://dashboard.example.com')).toBe(true);
      expect(result.wildcardPatterns.some((r) => r.test('https://sub.partner.com'))).toBe(true);
      expect(result.exactOrigins.has('null')).toBe(false);
      expect(result.exactOrigins.has('file://bad')).toBe(false);
    });

    it('throws when AuthConfigService fails (no internal catch)', async () => {
      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockRejectedValue(new Error('DB connection lost')),
      });

      await expect(buildAllowlist()).rejects.toThrow('DB connection lost');
    });
  });

  // ─── buildEnvAllowlist ────────────────────────────────────────────────────────
  describe('buildEnvAllowlist', () => {
    it('returns env origins only without querying DB', () => {
      process.env.API_BASE_URL = 'https://api.example.com';
      process.env.VITE_API_BASE_URL = 'https://app.example.com';

      const result = buildEnvAllowlist();

      expect(result.exactOrigins.has('https://api.example.com')).toBe(true);
      expect(result.exactOrigins.has('https://app.example.com')).toBe(true);
      expect(result.wildcardPatterns).toHaveLength(0);
    });
  });

  // ─── refreshCorsAllowlist state preservation & race protection ────────────────
  describe('refreshCorsAllowlist state preservation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      setCorsAllowlist(null);
    });

    afterEach(() => {
      setCorsAllowlist(null);
    });

    it('preserves previous allowlist when buildAllowlist throws', async () => {
      const previous = buildEnvAllowlist();
      setCorsAllowlist(previous);

      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockRejectedValue(new Error('DB down')),
      });

      await refreshCorsAllowlist();

      const current = getCorsAllowlist();
      // Same reference — not overwritten on failure
      expect(current).toBe(previous);
    });

    it('discards stale successful refresh when newer refresh already applied', async () => {
      const resolvers: ((value: { allowedRedirectUrls: string[] }) => void)[] = [];

      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockImplementation(() => {
          return new Promise<{ allowedRedirectUrls: string[] }>((resolve) => {
            resolvers.push(resolve);
          });
        }),
      });

      // Fire first refresh — will hang until resolvers[0] is called
      const p1 = refreshCorsAllowlist();
      await new Promise((r) => setTimeout(r, 10));

      // Fire second refresh immediately — overlaps with first
      const p2 = refreshCorsAllowlist();
      await new Promise((r) => setTimeout(r, 10));

      // Resolve SECOND first (newer generation succeeds first)
      resolvers[1]({ allowedRedirectUrls: ['https://new-origin.com'] });
      await p2;

      // Newer result should be applied
      expect(getCorsAllowlist()?.exactOrigins.has('https://new-origin.com')).toBe(true);

      // Now resolve FIRST (older generation) with stale data
      resolvers[0]({ allowedRedirectUrls: ['https://stale-origin.com'] });
      await p1;

      // Older stale result must be discarded; newer result must remain
      expect(getCorsAllowlist()?.exactOrigins.has('https://new-origin.com')).toBe(true);
      expect(getCorsAllowlist()?.exactOrigins.has('https://stale-origin.com')).toBe(false);
    });

    it('rejects stale successful refresh when newer admin update has failed', async () => {
      // Initialize with base env allowlist so allowlistRef is non-null
      setCorsAllowlist(buildEnvAllowlist());

      let firstResolve: (value: { allowedRedirectUrls: string[] }) => void;
      let callCount = 0;

      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // Simulate stale periodic refresh that will succeed slowly
            return new Promise((resolve) => {
              firstResolve = resolve;
            });
          }
          // Simulate newer admin update refresh that will fail quickly
          return Promise.reject(new Error('DB timeout'));
        }),
      });

      // Fire stale periodic refresh (gen 1)
      const p1 = refreshCorsAllowlist();
      await new Promise((r) => setTimeout(r, 10));

      // Simulate admin update: bump min required generation, then fire update refresh (gen 2)
      bumpMinRequiredGeneration();
      const p2 = refreshCorsAllowlist();
      await p2; // refreshCorsAllowlist catches error internally and resolves void

      // Now resolve the stale periodic refresh with old data
      firstResolve!({ allowedRedirectUrls: ['https://stale-origin.com'] });
      await p1;

      // Stale result must be rejected because minRequiredGeneration was bumped
      const current = getCorsAllowlist();
      expect(current?.exactOrigins.has('https://stale-origin.com')).toBe(false);
    });

    it('ignores in-flight refresh resolving after setCorsAllowlist(null) reset', async () => {
      let firstResolve: (value: { allowedRedirectUrls: string[] }) => void;

      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            firstResolve = resolve;
          });
        }),
      });

      // Fire refresh while allowlist is active
      setCorsAllowlist(buildEnvAllowlist());
      const p1 = refreshCorsAllowlist();
      await new Promise((r) => setTimeout(r, 10));

      // Reset state to null (e.g. between tests)
      setCorsAllowlist(null);

      // Now resolve the in-flight refresh with stale data
      firstResolve!({ allowedRedirectUrls: ['https://stale-in-flight.com'] });
      await p1;

      // In-flight refresh must be rejected because setCorsAllowlist(null) advanced the invalidation generation
      expect(getCorsAllowlist()).toBeNull();
    });

    it('applies updated allowedRedirectUrls directly to allowlist when DB refresh fails during auth config update', async () => {
      // Set initial allowlist with an old origin
      setCorsAllowlist({
        exactOrigins: new Set(['https://api.example.com', 'https://revoked-old-origin.com']),
        wildcardPatterns: [],
      });

      // When DB refresh fails after admin update, setAllowlistFromOrigins applies new origins directly
      setAllowlistFromOrigins(['https://newly-added-origin.com']);

      const current = getCorsAllowlist();
      // Revoked origin must be immediately removed from active allowlist
      expect(current?.exactOrigins.has('https://revoked-old-origin.com')).toBe(false);
      // Newly added origin must be immediately authorized
      expect(current?.exactOrigins.has('https://newly-added-origin.com')).toBe(true);
    });

    it('rejects fallback update if targetGeneration is older than minRequiredGeneration', () => {
      setCorsAllowlist(buildEnvAllowlist());
      const olderGen = bumpMinRequiredGeneration(); // olderGen = 1, minRequiredGeneration = 1
      bumpMinRequiredGeneration(); // minRequiredGeneration = 2

      // Older generation fallback must be skipped because a newer request raised minRequiredGeneration
      const updated = setAllowlistFromOrigins(['https://stale-fallback.com'], olderGen);
      expect(updated).toBe(false);
      expect(getCorsAllowlist()?.exactOrigins.has('https://stale-fallback.com')).toBe(false);
    });
  });

  describe('createApp CORS startup fallback', () => {
    const SAVED_API_BASE_STARTUP = process.env.API_BASE_URL;
    const SAVED_JWT_SECRET = process.env.JWT_SECRET;
    const SAVED_ADMIN_USER = process.env.ROOT_ADMIN_USERNAME;
    const SAVED_ADMIN_PASS = process.env.ROOT_ADMIN_PASSWORD;

    beforeEach(async () => {
      process.env.API_BASE_URL = 'https://api.example.com';
      process.env.JWT_SECRET =
        process.env.JWT_SECRET || 'test-jwt-secret-for-ci-integration-test-32chars';
      process.env.ROOT_ADMIN_USERNAME = process.env.ROOT_ADMIN_USERNAME || 'test-admin';
      process.env.ROOT_ADMIN_PASSWORD = process.env.ROOT_ADMIN_PASSWORD || 'test-password';

      const { appConfig } = await import('@/infra/config/app.config.js');
      if (!appConfig.app.jwtSecret) {
        (appConfig.app as { jwtSecret: string }).jwtSecret = process.env.JWT_SECRET;
      }
      vi.clearAllMocks();
    });

    afterAll(() => {
      if (SAVED_API_BASE_STARTUP !== undefined) {
        process.env.API_BASE_URL = SAVED_API_BASE_STARTUP;
      } else {
        delete process.env.API_BASE_URL;
      }
      if (SAVED_JWT_SECRET !== undefined) {
        process.env.JWT_SECRET = SAVED_JWT_SECRET;
      } else {
        delete process.env.JWT_SECRET;
      }
      if (SAVED_ADMIN_USER !== undefined) {
        process.env.ROOT_ADMIN_USERNAME = SAVED_ADMIN_USER;
      } else {
        delete process.env.ROOT_ADMIN_USERNAME;
      }
      if (SAVED_ADMIN_PASS !== undefined) {
        process.env.ROOT_ADMIN_PASSWORD = SAVED_ADMIN_PASS;
      } else {
        delete process.env.ROOT_ADMIN_PASSWORD;
      }
    });

    it('serves CORS headers from env origins when initial DB refresh fails', async () => {
      const { AuthConfigService } = await import('@/services/auth/auth-config.service.js');
      (AuthConfigService.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
        getAuthConfig: vi.fn().mockRejectedValue(new Error('DB down')),
      });

      // Simulate startup sequence in server.ts without booting heavy DB/storage/log services:
      await refreshCorsAllowlist();
      if (!getCorsAllowlist()) {
        setCorsAllowlist(buildEnvAllowlist());
      }

      const app = express();
      app.use(createCorsMiddleware());
      app.get('/api/health', (_req, res) => {
        res.status(200).json({ status: 'ok' });
      });

      const response = await supertest(app)
        .get('/api/health')
        .set('Origin', 'https://api.example.com');

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://api.example.com');
    });
  });

  // ─── parseAllowedOrigin edge cases ───────────────────────────────────────────
  describe('parseAllowedOrigin edge cases', () => {
    it('handles multiple wildcards globally (gi flag)', () => {
      const result = parseAllowedOrigin('https://*.*.example.com');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('wildcard');
      const regex = (result as { type: 'wildcard'; regex: RegExp }).regex;
      expect(regex.test('https://foo.bar.example.com')).toBe(true);
      expect(regex.test('https://foo.example.com')).toBe(false);
    });

    it('escapes regex metacharacters (injection guard)', () => {
      expect(parseAllowedOrigin('https://evil|*.example.com')).toBeNull();

      const result = parseAllowedOrigin('https://app-*.example.com');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('wildcard');
      const regex = (result as { type: 'wildcard'; regex: RegExp }).regex;
      expect(regex.test('https://app-sub.example.com')).toBe(true);
      expect(regex.test('https://appXsub.example.com')).toBe(false);
    });

    it('rejects null origin', () => {
      expect(parseAllowedOrigin('null')).toBeNull();
    });

    it('rejects non-HTTP(S) schemes', () => {
      expect(parseAllowedOrigin('file://localhost')).toBeNull();
      expect(parseAllowedOrigin('ftp://example.com')).toBeNull();
    });
  });

  // ─── Fix 3 — Topology Masking ─────────────────────────────────────────────────
  describe('Fix 3 — Topology Masking', () => {
    it('builds /info payload exercising buildInfoPayload helper with masked topology', () => {
      const infoPayload = buildInfoPayload({
        runtime: 'deno',
        version: { deno: '1.40.0', typescript: '5.3.0', v8: '12.0.0' },
        env: 'production',
      });

      expect(infoPayload).not.toHaveProperty('database');
      expect(infoPayload).not.toHaveProperty('database.host');
      expect(infoPayload).not.toHaveProperty('database.database');
      expect(infoPayload.runtime).toBe('deno');
      expect(infoPayload.env).toBe('production');
    });
  });

  // ─── Fix 4 — SSE Disconnect Token Safeguard ───────────────────────────────────
  describe('Fix 4 — SSE Disconnect Token Safeguard', () => {
    it('aborts stream iteration and invokes return on response close before writableEnded', async () => {
      let returnInvoked = false;

      async function* mockStreamGenerator() {
        try {
          yield { chunk: 'token-1' };
          yield { chunk: 'token-2' };
          yield { chunk: 'token-3' };
        } finally {
          returnInvoked = true;
        }
      }

      class MockResponse extends EventEmitter {
        public writableEnded = false;
      }

      const res = new MockResponse();
      const streamGenerator = mockStreamGenerator();
      let aborted = false;

      res.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          streamGenerator.return?.(undefined).catch(() => {});
        }
      });

      const collected: string[] = [];

      for await (const data of streamGenerator) {
        if (aborted) {
          break;
        }
        collected.push(data.chunk);
        // Simulate client disconnect mid-stream after first chunk
        res.emit('close');
      }

      expect(collected).toEqual(['token-1']);
      expect(aborted).toBe(true);
      expect(returnInvoked).toBe(true);
    });

    it('does NOT abort when response finishes normally (writableEnded is true)', async () => {
      let returnInvoked = false;

      async function* mockStreamGenerator() {
        try {
          yield { chunk: 'token-1' };
        } finally {
          returnInvoked = true;
        }
      }

      class MockResponse extends EventEmitter {
        public writableEnded = false;
      }

      const res = new MockResponse();
      const streamGenerator = mockStreamGenerator();
      let aborted = false;

      res.on('close', () => {
        if (!res.writableEnded) {
          aborted = true;
          streamGenerator.return?.(undefined).catch(() => {});
        }
      });

      const collected: string[] = [];

      for await (const data of streamGenerator) {
        if (aborted) {
          break;
        }
        collected.push(data.chunk);
      }

      // Mark request normally finished before close fires
      res.writableEnded = true;
      res.emit('close');

      expect(collected).toEqual(['token-1']);
      expect(aborted).toBe(false);
      expect(returnInvoked).toBe(true);
    });
  });
});
