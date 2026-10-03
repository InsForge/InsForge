import cors, { CorsOptions } from 'cors';
import { RequestHandler } from 'express';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';
import { getApiBaseUrl } from '@/utils/environment.js';
import logger from '@/utils/logger.js';

/**
 * Dynamic CORS allowlist, replacing the previous `origin: true` (reflect any
 * origin) + `credentials: true` combination, which let any website make
 * authenticated, cookie-bearing requests against this API.
 *
 * An origin is allowed when it is either:
 *   - the API's own base URL (same-origin dashboard/self-host deployments), or
 *   - a match for one of the project's configured `allowedRedirectUrls`
 *     (the same allowlist OAuth/email-verification redirects already use).
 *
 * When no `allowedRedirectUrls` are configured, this falls back to the prior
 * permissive behavior (allow all) — matching `AuthConfigService.validateRedirectUrl`'s
 * own "no policy configured" default — so a fresh install or a project that
 * hasn't set one up yet keeps working exactly as before. Configuring an
 * allowlist is what turns real enforcement on.
 */

const ALLOWLIST_CACHE_MS = 30_000;

let cache: { allowedRedirectUrls: string[]; fetchedAt: number } | null = null;
let refreshPromise: Promise<string[]> | null = null;

async function getAllowedRedirectUrls(): Promise<string[]> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < ALLOWLIST_CACHE_MS) {
    return cache.allowedRedirectUrls;
  }

  // Coalesce concurrent refreshes into a single DB read.
  if (!refreshPromise) {
    refreshPromise = AuthConfigService.getInstance()
      .getAuthConfig()
      .then((config) => {
        const urls = config.allowedRedirectUrls ?? [];
        cache = { allowedRedirectUrls: urls, fetchedAt: Date.now() };
        return urls;
      })
      .catch((error) => {
        // A known-good list from a previous fetch is safe to keep serving
        // (stale allowlist beats treating a transient DB error as "no
        // allowlist configured", which the caller reads as allow-all). With
        // no prior successful fetch there is nothing safe to fall back to,
        // so the error propagates and the caller fails closed instead.
        if (cache) {
          logger.error('Failed to refresh CORS allowlist; keeping previous list', { error });
          // Re-arm the TTL against this failed attempt too, not just a
          // successful one — otherwise a DB outage past the TTL means every
          // subsequent request re-enters this branch and issues (and fails)
          // another DB read, instead of serving the stale list for a full
          // window before trying again.
          cache.fetchedAt = Date.now();
          return cache.allowedRedirectUrls;
        }
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Ports the URL parser (and therefore Origin headers, which always come from
// a real URL) already omits for these schemes — a pattern that spells one
// out explicitly (`https://app.example.com:443`) must still match the origin
// the browser actually sends (`https://app.example.com`).
const DEFAULT_PORT_BY_SCHEME: Record<string, string> = { 'http:': '80', 'https:': '443' };

function stripDefaultPort(scheme: string, host: string): string {
  const defaultPort = DEFAULT_PORT_BY_SCHEME[`${scheme}:`];
  return defaultPort && host.endsWith(`:${defaultPort}`)
    ? host.slice(0, -(defaultPort.length + 1))
    : host;
}

/**
 * Extracts `scheme://host[:port]` from a redirect-URL pattern, discarding any
 * path/query — an `Origin` header never carries either. `host` may contain
 * `*` wildcards anywhere (matching `AuthConfigService`'s own glob patterns,
 * e.g. `*.example.com` or `*foo.example.com`); broader glob forms (`**`,
 * `?`, `[...]`) don't have a meaningful analogue for a path-less origin and
 * are intentionally not supported here.
 */
function originFromPattern(pattern: string): { scheme: string; host: string } | null {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/.exec(pattern);
  if (!match) {
    return null;
  }
  const scheme = match[1].toLowerCase();
  return { scheme, host: stripDefaultPort(scheme, match[2].toLowerCase()) };
}

function hostPatternToRegExp(hostPattern: string): RegExp {
  const escaped = hostPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export function originMatchesPattern(pattern: string, origin: string): boolean {
  const parsedPattern = originFromPattern(pattern);
  if (!parsedPattern) {
    return false;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  if (originUrl.protocol !== `${parsedPattern.scheme}:`) {
    return false;
  }

  const originHost = originUrl.host.toLowerCase(); // URL already omits a default port
  if (!parsedPattern.host.includes('*')) {
    return parsedPattern.host === originHost;
  }
  return hostPatternToRegExp(parsedPattern.host).test(originHost);
}

const corsOriginCallback: NonNullable<CorsOptions['origin']> = (origin, callback) => {
  // No Origin header: same-origin browser requests, curl, mobile/server
  // clients. The browser CORS check this option controls doesn't apply to them.
  if (!origin) {
    return callback(null, true);
  }

  if (origin === getApiBaseUrl()) {
    return callback(null, true);
  }

  getAllowedRedirectUrls()
    .then((allowedRedirectUrls) => {
      const allowed =
        allowedRedirectUrls.length === 0 ||
        allowedRedirectUrls.some((pattern) => originMatchesPattern(pattern, origin));
      callback(null, allowed);
    })
    .catch((error) => {
      logger.error('CORS origin check failed, rejecting request', { error, origin });
      callback(null, false);
    });
};

export const corsMiddleware: RequestHandler = cors({
  origin: corsOriginCallback,
  credentials: true,
  exposedHeaders: ['Content-Range', 'Preference-Applied'],
});
