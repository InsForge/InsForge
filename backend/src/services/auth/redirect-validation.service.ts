import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

/**
 * Normalise a URL string so that comparisons are consistent.
 * - Lowercases the scheme and hostname (they are case-insensitive per RFC 3986)
 * - Strips a trailing slash from the path so https://a.com/ and https://a.com compare equal
 * - Preserves path, query and fragment exactly as given
 */
function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    // Lowercase scheme and host (RFC 3986 §6.2.2.1)
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    // Strip a bare trailing slash (path is just '/') to treat https://a.com and https://a.com/ as equal
    let href = parsed.href;
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      href = href.replace(/\/$/, '');
    }
    return href;
  } catch {
    return raw;
  }
}

/**
 * Determine whether `candidate` matches a single whitelist `entry`.
 *
 * Matching rules (in priority order):
 * 1. Exact match after normalisation.
 * 2. Wildcard subdomain: if the entry starts with '*.' the rest is treated as
 *    a suffix pattern — e.g. '*.example.com' matches 'app.example.com' but
 *    NOT 'example.com' itself (the wildcard requires at least one subdomain
 *    label).  Scheme and port must still match exactly.
 */
function matchesEntry(candidate: string, entry: string): boolean {
  const normCandidate = normalizeUrl(candidate);
  const normEntry = normalizeUrl(entry);

  // 1. Exact match
  if (normCandidate === normEntry) {
    return true;
  }

  // 2. Wildcard subdomain — entry must start with '*.'
  if (entry.startsWith('*.')) {
    try {
      const parsedEntry = new URL('https://' + entry.slice(2));
      const parsedCandidate = new URL(candidate);

      // Scheme must match the entry (re-derive the entry's scheme from the
      // original entry string which may be 'https://*.example.com')
      const entryUrl = new URL(entry.replace('*.', 'placeholder.'));
      if (parsedCandidate.protocol.toLowerCase() !== entryUrl.protocol.toLowerCase()) {
        return false;
      }
      // Port must match
      if (parsedCandidate.port !== entryUrl.port) {
        return false;
      }
      // Hostname of candidate must end with '.<suffix>'
      const suffix = parsedEntry.hostname.toLowerCase();
      const candidateHost = parsedCandidate.hostname.toLowerCase();
      if (!candidateHost.endsWith('.' + suffix)) {
        return false;
      }
      // Ensure there is exactly one extra label (no multi-level wildcards)
      const extraPart = candidateHost.slice(0, candidateHost.length - suffix.length - 1);
      if (!extraPart || extraPart.includes('.')) {
        return false;
      }
      // Path must match exactly
      if (parsedCandidate.pathname !== entryUrl.pathname) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Validate a redirect URL against the configured whitelist.
 *
 * Behaviour:
 * - If the whitelist is empty the call is a no-op (permissive / dev-mode).
 * - If the whitelist is non-empty and the URL does not match any entry an
 *   AppError(400, INVALID_INPUT) is thrown.
 *
 * @param redirectUrl  The URL that the auth flow wants to redirect to.
 * @param whitelist    The list of allowed URL patterns from auth.configs.
 */
export function validateRedirectUrl(redirectUrl: string, whitelist: string[]): void {
  if (!whitelist || whitelist.length === 0) {
    // Empty whitelist — permissive mode (development-friendly default)
    logger.warn(
      '[Auth] Redirect URL whitelist is empty — redirect accepted without validation. ' +
        'Configure a whitelist in Auth Settings for production deployments.',
      { redirectUrl }
    );
    return;
  }

  const allowed = whitelist.some((entry) => matchesEntry(redirectUrl, entry));
  if (!allowed) {
    logger.warn('[Auth] Redirect URL rejected — not on whitelist', { redirectUrl, whitelist });
    throw new AppError(
      `Redirect URL '${redirectUrl}' is not allowed. Add it to the redirect URL whitelist in Auth Settings.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  logger.debug('[Auth] Redirect URL validated against whitelist', { redirectUrl });
}
