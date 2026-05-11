import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

import { AuthConfigService } from '../../src/services/auth/auth-config.service';
import { logger } from '../../src/utils/logger';
import { allowedRedirectUrlsRegex } from '@insforge/shared-schemas';

/**
 * Helper: stub `getAuthConfig` to return the given allowedRedirectUrls.
 * Uses `mockResolvedValue` so the same stub persists across multiple calls
 * within a single test.
 */
function stubAllowedUrls(urls: string[] | null) {
  mockPool.query.mockResolvedValue({
    rows: [{ allowedRedirectUrls: urls }],
  });
}

describe('AuthConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Permissive defaults (no allowlist configured)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — permissive defaults', () => {
    it('returns true when allowedRedirectUrls is an empty array', async () => {
      stubAllowedUrls([]);

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('returns true when allowedRedirectUrls is null', async () => {
      stubAllowedUrls(null);

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(true);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Exact match (no glob characters)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — exact match', () => {
    it('returns true when URL matches exactly', async () => {
      stubAllowedUrls(['https://myapp.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com')).toBe(true);
    });

    it('returns false when URL does not match', async () => {
      stubAllowedUrls(['https://myapp.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://attacker.com')).toBe(false);
    });

    it('handles multiple exact URLs in whitelist', async () => {
      stubAllowedUrls(['https://myapp.com', 'https://otherapp.io']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://otherapp.io')).toBe(true);
      expect(await service.validateRedirectUrl('https://malicious.com')).toBe(false);
    });

    it('normalises trailing slashes for exact match', async () => {
      stubAllowedUrls(['https://myapp.com/']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com')).toBe(true);
    });

    it('matches exact URL with path', async () => {
      stubAllowedUrls(['https://myapp.com/auth/callback']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com/auth/callback')).toBe(true);
      expect(await service.validateRedirectUrl('https://myapp.com/other')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Subdomain wildcard  (back-compat with legacy *.host.com)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — subdomain wildcard (*.host)', () => {
    it('matches a single subdomain', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://app.example.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://staging.example.com')).toBe(true);
    });

    it('matches deeply nested subdomains', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://deep.sub.example.com')).toBe(true);
    });

    it('does NOT match the apex domain itself', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com')).toBe(false);
    });

    it('does NOT match a completely different domain', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://other.com')).toBe(false);
    });

    it('does NOT match domain-confusion attack (evil-example.com)', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://evil-example.com')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Path wildcard — single segment (*)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — path wildcard (*)', () => {
    it('matches a single path segment', async () => {
      stubAllowedUrls(['https://example.com/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo')).toBe(true);
    });

    it('does NOT match multiple path segments', async () => {
      stubAllowedUrls(['https://example.com/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo/bar')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Path wildcard — recursive (**)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — recursive path wildcard (**)', () => {
    it('matches a single path segment', async () => {
      stubAllowedUrls(['https://example.com/**']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo')).toBe(true);
    });

    it('matches deeply nested paths', async () => {
      stubAllowedUrls(['https://example.com/**']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo/bar')).toBe(true);
      expect(await service.validateRedirectUrl('https://example.com/foo/bar/baz')).toBe(true);
    });

    it('matches path with query string', async () => {
      stubAllowedUrls(['https://example.com/**']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/path?param=value')).toBe(true);
    });

    it('matches the root URL itself (trailing-slash form)', async () => {
      stubAllowedUrls(['https://example.com/**']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/')).toBe(true);
    });

    it('matches the bare apex URL (no trailing slash)', async () => {
      stubAllowedUrls(['https://example.com/**']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Combined wildcards (subdomain + path)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — combined wildcards', () => {
    it('matches subdomain + path wildcard', async () => {
      stubAllowedUrls(['https://*.example.com/auth/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://app.example.com/auth/callback')).toBe(true);
    });

    it('rejects non-matching path under matching subdomain', async () => {
      stubAllowedUrls(['https://*.example.com/auth/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://app.example.com/other')).toBe(false);
    });

    it('rejects non-matching subdomain with matching path', async () => {
      stubAllowedUrls(['https://*.example.com/auth/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://other.com/auth/callback')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Query string wildcards
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — query string wildcards', () => {
    it('matches query parameter with wildcard value', async () => {
      stubAllowedUrls(['https://example.com/?session=*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/?session=abc')).toBe(true);
    });

    it('does not match different query parameter name', async () => {
      stubAllowedUrls(['https://example.com/?session=*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/?token=abc')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Protocol strictness
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — protocol strictness', () => {
    it('rejects http when https is required', async () => {
      stubAllowedUrls(['https://example.com/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('http://example.com/foo')).toBe(false);
    });

    it('rejects https when http is required', async () => {
      stubAllowedUrls(['http://example.com/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo')).toBe(false);
    });

    it('protocol mismatch with subdomain wildcard', async () => {
      stubAllowedUrls(['https://*.example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('http://app.example.com')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Port strictness
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — port strictness', () => {
    it('rejects port mismatch', async () => {
      stubAllowedUrls(['https://example.com:3000/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com:3001/foo')).toBe(false);
    });

    it('matches same port', async () => {
      stubAllowedUrls(['https://example.com:3000/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com:3000/foo')).toBe(true);
    });

    it('rejects explicit port when pattern has default port', async () => {
      stubAllowedUrls(['https://example.com/*']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com:8080/foo')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Malformed / edge-case inputs
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — malformed input', () => {
    it('rejects malformed target URL', async () => {
      stubAllowedUrls(['https://example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('not-a-url')).toBe(false);
    });

    it('rejects empty target URL', async () => {
      stubAllowedUrls(['https://example.com']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('')).toBe(false);
    });

    // Pins the behavior of the unparseable-pattern branch in normalizePattern.
    // A pattern that fails URL parsing even after glob-placeholder substitution
    // should never match anything. The schema regex normally blocks such input;
    // this test bypasses it via the mocked DB to verify the runtime guard.
    it('rejects unparseable pattern that bypassed schema validation', async () => {
      // 'not a url' fails URL parsing whether or not we substitute glob tokens,
      // so normalizePattern returns the unmatchable sentinel.
      stubAllowedUrls(['not a url *']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://example.com/foo')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // IPv6 hosts — brackets must be matched as URL syntax, not as glob char class
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — IPv6 hosts', () => {
    it('matches IPv6 host pattern against itself', async () => {
      stubAllowedUrls(['https://[::1]/cb']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://[::1]/cb')).toBe(true);
    });

    it('matches a longer IPv6 address', async () => {
      stubAllowedUrls(['https://[2001:db8::1]/cb']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://[2001:db8::1]/cb')).toBe(true);
    });

    it('matches IPv6 case-insensitively (URL.href lowercases the host)', async () => {
      stubAllowedUrls(['https://[FFFF::1]/cb']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://[ffff::1]/cb')).toBe(true);
    });

    it('does NOT match a single-character host (regression: char-class over-match)', async () => {
      stubAllowedUrls(['https://[::1]/cb']);

      const service = AuthConfigService.getInstance();
      // Without the IPv6 escape, picomatch would treat `[::1]` as a char
      // class and let `1` (a single char from the class) match the host.
      expect(await service.validateRedirectUrl('https://1/cb')).toBe(false);
    });

    it('does NOT match a different IPv6 address', async () => {
      stubAllowedUrls(['https://[::1]/cb']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://[::2]/cb')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Custom scheme support (deep links)
  // --------------------------------------------------------------------------
  describe('validateRedirectUrl — custom schemes', () => {
    it('matches exact custom scheme URL', async () => {
      stubAllowedUrls(['myapp://auth/callback']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('myapp://auth/callback')).toBe(true);
    });

    it('rejects different custom scheme', async () => {
      stubAllowedUrls(['myapp://auth/callback']);

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('otherapp://auth/callback')).toBe(false);
    });
  });
});

// ----------------------------------------------------------------------------
// Schema-level input validation regex
// ----------------------------------------------------------------------------
describe('allowedRedirectUrlsRegex — input validation', () => {
  describe('rejects degenerate / empty hosts', () => {
    it.each([
      ['https://'],
      ['http://'],
      ['https://:8080'],
      ['https:///path'],
      ['https://*'],
      ['https://*.'],
      ['https://*.:8080'],
      ['https://.'],
    ])('rejects %s', (input) => {
      expect(allowedRedirectUrlsRegex.test(input)).toBe(false);
    });
  });

  describe('accepts valid patterns and URLs', () => {
    it.each([
      ['https://example.com'],
      ['https://*.example.com'],
      ['https://example.com/*'],
      ['https://example.com/**'],
      ['https://*.example.com/auth/*'],
      ['https://example.com/?session=*'],
      ['https://example.com/[a-z]*'],
      ['https://*foo.example.com'],
      ['https://example.com:3000/*'],
      ['https://[::1]/cb'],
      ['https://[::1]:8080'],
      ['myapp://auth/callback'],
    ])('accepts %s', (input) => {
      expect(allowedRedirectUrlsRegex.test(input)).toBe(true);
    });
  });

  describe('rejects unsafe / malformed inputs', () => {
    it.each([
      ['*.example.com'], // missing scheme
      ['javascript:alert(1)'],
      ['data:text/html,xss'],
      ['file:///etc/passwd'],
    ])('rejects %s', (input) => {
      expect(allowedRedirectUrlsRegex.test(input)).toBe(false);
    });
  });
});
