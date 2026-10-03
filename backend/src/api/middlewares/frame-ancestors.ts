import { RequestHandler } from 'express';
import logger from '@/utils/logger.js';

/**
 * Restores frame-ancestors protection that plain `frameguard: false` removed
 * entirely. The cloud-hosting partner embeds the dashboard in a cross-origin
 * iframe (frontend/src/cloud-hosting/useCloudHosting.ts), so a blanket
 * X-Frame-Options/CSP frame-ancestors block would break that supported flow —
 * but allowing every origin to frame the authenticated dashboard is a
 * clickjacking hole. This builds a `frame-ancestors` CSP value scoped to
 * `'self'` plus the same trusted partner origins the frontend already reads
 * from `https://config.insforge.dev/partnership.json`
 * (frontend/src/cloud-hosting/partner.service.ts), so only that trusted
 * partner — not the entire web — can frame these pages.
 *
 * This middleware is mounted globally, ahead of every route including health
 * checks and webhooks, so it must never make a request wait on the outbound
 * fetch to config.insforge.dev: it always applies the header synchronously
 * from whatever is already cached and refreshes the cache in the background.
 * `warmPartnerOriginsCache()` is awaited once at server startup (see
 * server.ts) so the cache is already populated before the first real
 * request arrives — including the partner's own dashboard-embedding
 * request — instead of that first request racing the background fetch and
 * getting a 'self'-only policy it can never recover from.
 */

const PARTNERSHIP_CONFIG_URL = 'https://config.insforge.dev/partnership.json';
const PARTNER_ORIGINS_CACHE_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

let cache: { partnerOrigins: string[]; fetchedAt: number } | null = null;
let refreshPromise: Promise<void> | null = null;

async function fetchPartnerOrigins(): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(PARTNERSHIP_CONFIG_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }
    const data = (await response.json()) as { partner_sites?: unknown };
    const sites = Array.isArray(data.partner_sites) ? data.partner_sites : [];
    const origins = new Set<string>();
    for (const site of sites) {
      if (typeof site !== 'string') {
        continue;
      }
      try {
        origins.add(new URL(site).origin);
      } catch {
        // Skip malformed entries rather than failing the whole fetch.
      }
    }
    return [...origins];
  } finally {
    clearTimeout(timeout);
  }
}

// Kicks off a refresh and returns the promise so callers that want to await
// it (server startup) can, while callers on the request path can fire it and
// move on without waiting. Concurrent callers that all see a stale/missing
// cache in the same tick coalesce into a single outbound fetch.
function refreshPartnerOrigins(): Promise<void> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = fetchPartnerOrigins()
    .then((partnerOrigins) => {
      cache = { partnerOrigins, fetchedAt: Date.now() };
    })
    .catch((error) => {
      if (cache) {
        logger.error(
          'Failed to refresh partner origins for frame-ancestors; keeping previous list',
          { error }
        );
        // Re-arm the TTL against this failed attempt too, so a sustained
        // outage doesn't retry on every single request.
        cache.fetchedAt = Date.now();
      } else {
        logger.error(
          'Failed to fetch partner origins for frame-ancestors; defaulting to self only',
          { error }
        );
        // Cache the empty result too (also re-armed on the same TTL) —
        // otherwise every request during an outage would see `cache` still
        // null and kick off yet another fetch of its own once this one
        // settles.
        cache = { partnerOrigins: [], fetchedAt: Date.now() };
      }
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function getCachedPartnerOrigins(): string[] {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt >= PARTNER_ORIGINS_CACHE_MS) {
    // Fire-and-forget: the request path must not wait on this.
    void refreshPartnerOrigins();
  }
  // Serve whatever is cached right now (possibly stale) rather than waiting
  // on the refresh above.
  return cache?.partnerOrigins ?? [];
}

/**
 * Awaited once during server startup (before the app starts accepting
 * connections) so the very first request — which may itself be the
 * partner's iframe load — already sees a warm cache instead of racing a
 * background fetch it has no way to recover from. Failure here is not
 * fatal: it just means the server starts with the same 'self'-only fallback
 * the request-path refresh would have produced anyway.
 */
export async function warmPartnerOriginsCache(): Promise<void> {
  await refreshPartnerOrigins();
}

export const frameAncestorsMiddleware: RequestHandler = (_req, res, next) => {
  const sources = ["'self'", ...getCachedPartnerOrigins()];
  res.setHeader('Content-Security-Policy', `frame-ancestors ${sources.join(' ')}`);
  next();
};
