import type { CorsOptions } from 'cors';

/**
 * Parse CORS_ALLOWED_ORIGINS into an allow-list of normalized origins.
 *
 * - unset / empty / `*`  → `undefined`: reflect any Origin (backward compatible
 *   default; SDK apps on arbitrary origins rely on credentialed refresh calls)
 * - comma-separated list → exact-match allow-list. Each entry is normalized to
 *   `scheme://host[:port]` (lower-cased, no path, no trailing slash) so that
 *   `https://App.example.com/` and `https://app.example.com` compare equal.
 *   Entries that are not absolute URLs are kept as-is (lower-cased) so a typo
 *   fails closed rather than silently widening the list.
 */
export function parseCorsAllowedOrigins(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0 || entries.includes('*')) {
    return undefined;
  }

  const normalized = new Set<string>();
  for (const entry of entries) {
    normalized.add(normalizeOrigin(entry));
  }
  return [...normalized];
}

export function normalizeOrigin(value: string): string {
  try {
    const url = new URL(value);
    // `URL.origin` is "null" for non-special schemes; fall back to raw input.
    return url.origin === 'null' ? value.toLowerCase() : url.origin.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

/**
 * Decide whether a request Origin may receive CORS headers.
 * Requests without an Origin header (curl, server-to-server, same-origin
 * navigations) are not cross-origin browser requests and are always allowed.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[] | undefined
): boolean {
  if (!origin || allowedOrigins === undefined) {
    return true;
  }
  return allowedOrigins.includes(normalizeOrigin(origin));
}

/**
 * Build the `origin` option for the `cors` middleware.
 * With no allow-list this reflects the request Origin exactly as `origin: true`
 * did before; with an allow-list, unlisted origins get no CORS headers (the
 * browser then blocks the response, and credentials are never shared).
 */
export function buildCorsOriginOption(allowedOrigins: string[] | undefined): CorsOptions['origin'] {
  if (allowedOrigins === undefined) {
    return true;
  }
  return (origin, callback) => {
    callback(null, isOriginAllowed(origin, allowedOrigins));
  };
}
