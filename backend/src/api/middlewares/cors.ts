import cors from 'cors';
import logger from '@/utils/logger.js';

// Module-level mutable state — refreshed periodically at runtime
let allowlistRef: {
  exactOrigins: Set<string>;
  wildcardPatterns: RegExp[];
} | null = null;

let refreshGeneration = 0;
let appliedGeneration = 0;
let minRequiredGeneration = 0;

/**
 * Returns the current CORS allowlist reference.
 *
 * @returns The current allowlist, or null if not yet initialized
 */
export const getCorsAllowlist = (): typeof allowlistRef => allowlistRef;

/**
 * Sets the CORS allowlist directly, replacing the current reference.
 *
 * @param allowlist - The new allowlist to activate, or null to clear
 */
export const setCorsAllowlist = (
  allowlist: { exactOrigins: Set<string>; wildcardPatterns: RegExp[] } | null
): void => {
  allowlistRef = allowlist;
  if (allowlist === null) {
    const invalidationGeneration = ++refreshGeneration;
    appliedGeneration = invalidationGeneration;
    minRequiredGeneration = invalidationGeneration;
  }
};

/**
 * Escapes all regex metacharacters in a string.
 * Must be called before any wildcard substitution.
 *
 * @param value - The raw string to escape
 * @returns The string with all regex metacharacters escaped
 */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Normalizes a URL string to its origin.
 * Rejects null origins, non-HTTP(S) schemes, and malformed URLs.
 *
 * @param url - The raw URL string to normalize
 * @returns The normalized origin, or undefined if invalid
 */
export const normalizeOrigin = (url: string | undefined): string | undefined => {
  if (!url || url === 'null') {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
};

/**
 * Parses an allowed origin entry. Supports exact origins and wildcard host patterns.
 * Normalizes casing via URL parsing before regex compilation, and safely escapes
 * ALL regex metacharacters before applying wildcard replacement.
 * Uses global replacement (gi) to handle multiple wildcards in a single pattern.
 *
 * @param url - The raw URL or wildcard pattern string
 * @returns Object indicating 'exact' or 'wildcard' type, or null if unparseable
 */
export const parseAllowedOrigin = (
  url: string
): { type: 'exact'; value: string } | { type: 'wildcard'; regex: RegExp } | null => {
  if (!url || url === 'null') {
    return null;
  }

  if (url.includes('*')) {
    // Extract origin portion (scheme + host + port)
    const originPart = url.split('/').slice(0, 3).join('/');
    if (!originPart.match(/^https?:\/\//)) {
      return null;
    }

    // Normalize casing via URL parsing, preserving the wildcard token
    const token = '___WILDCARD___';
    const tempUrl = originPart.replace(/\*/g, token);

    let normalizedOriginPart: string;
    try {
      const parsed = new URL(tempUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      // Reject userinfo (username / password) in origin URLs
      if (parsed.username || parsed.password) {
        return null;
      }
      // If the origin portion has no wildcard (wildcard was in path or query),
      // treat it as an exact origin: parsed.origin
      if (!originPart.includes('*')) {
        return { type: 'exact', value: parsed.origin };
      }

      // Require the wildcard token to remain inside the parsed hostname
      // Rejects patterns such as https://*.example.com@evil.com
      if (!parsed.hostname.toLowerCase().includes(token.toLowerCase())) {
        return null;
      }
      // Use gi (case-insensitive + global) since URL() lowercases the token,
      // and multiple wildcards need all placeholders replaced
      normalizedOriginPart = parsed.origin.replace(new RegExp(token, 'gi'), '*');
    } catch {
      // Return null when URL parsing throws
      return null;
    }

    // Escape ALL regex metacharacters first, then replace escaped \* with wildcard token matching domain labels
    const regexStr = escapeRegex(normalizedOriginPart).replace(/\\\*/g, '[a-zA-Z0-9.-]+');
    return { type: 'wildcard', regex: new RegExp('^' + regexStr + '$') };
  }

  const normalized = normalizeOrigin(url);
  if (!normalized) {
    return null;
  }
  return { type: 'exact', value: normalized };
};

/**
 * Parses a configured origin URL and adds it to the target exact set or wildcard regex list.
 * Logs a warning if the URL is invalid or malformed.
 *
 * @param url - Raw URL string to parse and add
 * @param exactOrigins - Set of exact allowed origins to accumulate into
 * @param wildcardPatterns - Array of compiled wildcard regexes to accumulate into
 */
const addUrlToAllowlist = (
  url: string | undefined,
  exactOrigins: Set<string>,
  wildcardPatterns: RegExp[]
): void => {
  if (!url) {
    return;
  }
  const parsed = parseAllowedOrigin(url);
  if (!parsed) {
    logger.warn('Rejected invalid configured origin in CORS allowlist', { url });
    return;
  }
  if (parsed.type === 'exact') {
    exactOrigins.add(parsed.value);
  } else {
    wildcardPatterns.push(parsed.regex);
  }
};

/**
 * Builds the complete CORS allowlist from environment variables and database auth config.
 * Must be called AFTER the database is initialized.
 * Throws if the database auth config cannot be loaded, so callers can detect partial failure.
 *
 * @returns Object containing exactOrigins set and wildcardPatterns array
 * @throws If AuthConfigService is unavailable or getAuthConfig() rejects
 */
export const buildAllowlist = async (): Promise<{
  exactOrigins: Set<string>;
  wildcardPatterns: RegExp[];
}> => {
  const exactOrigins = new Set<string>();
  const wildcardPatterns: RegExp[] = [];

  const add = (url: string | undefined) => addUrlToAllowlist(url, exactOrigins, wildcardPatterns);

  // Environment origins (always present)
  add(process.env.API_BASE_URL);
  add(process.env.VITE_API_BASE_URL);

  // Database origins — THROW on failure so caller knows allowlist is incomplete
  const { AuthConfigService } = await import('../../services/auth/auth-config.service.js');
  const config = await AuthConfigService.getInstance().getAuthConfig();
  config.allowedRedirectUrls?.forEach(add);

  return { exactOrigins, wildcardPatterns };
};

/**
 * Builds an environment-only CORS allowlist without any database query.
 * Used as a fallback when the database is unreachable at startup.
 *
 * @returns Object containing exactOrigins set and wildcardPatterns array from env vars only
 */
export const buildEnvAllowlist = (): {
  exactOrigins: Set<string>;
  wildcardPatterns: RegExp[];
} => {
  const exactOrigins = new Set<string>();
  const wildcardPatterns: RegExp[] = [];

  const add = (url: string | undefined) => addUrlToAllowlist(url, exactOrigins, wildcardPatterns);

  add(process.env.API_BASE_URL);
  add(process.env.VITE_API_BASE_URL);

  return { exactOrigins, wildcardPatterns };
};

/**
 * Directly sets the allowlist from provided DB redirect URLs and environment variables.
 * Guarantees that removed origins are immediately revoked even if a full DB query fails.
 * Checks targetGeneration to prevent stale concurrent requests from overwriting newer allowlists.
 *
 * @param allowedRedirectUrls - List of allowed redirect URLs from auth configuration
 * @param targetGeneration - Optional generation token to prevent overwriting newer updates
 * @returns True if allowlist was updated, false if skipped due to newer applied generation
 */
export const setAllowlistFromOrigins = (
  allowedRedirectUrls?: string[] | null,
  targetGeneration?: number
): boolean => {
  if (
    targetGeneration !== undefined &&
    targetGeneration < Math.max(appliedGeneration, minRequiredGeneration)
  ) {
    logger.warn('Skipping CORS allowlist fallback: a newer generation has already applied', {
      targetGeneration,
      appliedGeneration,
      minRequiredGeneration,
    });
    return false;
  }

  const exactOrigins = new Set<string>();
  const wildcardPatterns: RegExp[] = [];

  const add = (url: string | undefined) => addUrlToAllowlist(url, exactOrigins, wildcardPatterns);

  add(process.env.API_BASE_URL);
  add(process.env.VITE_API_BASE_URL);
  if (Array.isArray(allowedRedirectUrls)) {
    allowedRedirectUrls.forEach(add);
  }

  const generation = ++refreshGeneration;
  allowlistRef = { exactOrigins, wildcardPatterns };
  appliedGeneration = generation;
  minRequiredGeneration = generation;
  return true;
};

/**
 * Checks if a request origin is allowed by exact match or wildcard regex.
 *
 * @param requestOrigin - The incoming request origin header value
 * @param exactOrigins - Set of exact allowed origins
 * @param wildcardPatterns - Array of compiled wildcard regex patterns
 * @returns True if the origin is allowed, false otherwise
 */
export const isOriginAllowed = (
  requestOrigin: string,
  exactOrigins: Set<string>,
  wildcardPatterns: RegExp[]
): boolean => {
  if (exactOrigins.has(requestOrigin)) {
    return true;
  }
  return wildcardPatterns.some((regex) => regex.test(requestOrigin));
};

/**
 * Bumps the minimum required generation for allowlist updates.
 * Call this before triggering a refresh that MUST win over any in-flight periodic refresh.
 *
 * @returns The new minimum required generation number
 */
export const bumpMinRequiredGeneration = (): number => {
  minRequiredGeneration = ++refreshGeneration;
  return minRequiredGeneration;
};

/**
 * Rebuilds the CORS allowlist from database and environment.
 * Preserves the previous allowlist on failure.
 * Rejects stale in-flight refreshes that started before the latest admin update.
 *
 * @returns Promise resolving to true if allowlist was updated, false otherwise
 */
export const refreshCorsAllowlist = async (): Promise<boolean> => {
  const generation = ++refreshGeneration;
  try {
    const fresh = await buildAllowlist();
    // Only apply if this generation is newer/equal to the last success
    // AND newer/equal to the last admin update bump.
    // This prevents a stale periodic refresh from overwriting a failed update refresh.
    if (generation >= appliedGeneration && generation >= minRequiredGeneration) {
      allowlistRef = fresh;
      appliedGeneration = generation;
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('CORS allowlist refresh failed, keeping previous state', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Do NOT change appliedGeneration or allowlistRef on failure.
    // minRequiredGeneration stays as-is so future refreshes must meet the bar.
    return false;
  }
};

/**
 * Creates the CORS middleware. Reads from the mutable allowlistRef which is
 * refreshed periodically at runtime. Call refreshCorsAllowlist() before mounting.
 *
 * @returns Configured Express CORS middleware instance
 */
export const createCorsMiddleware = () => {
  return cors({
    origin: (requestOrigin, callback) => {
      const allowlist = allowlistRef;
      if (!allowlist) {
        callback(new Error('CORS allowlist not initialized'));
        return;
      }
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      if (isOriginAllowed(requestOrigin, allowlist.exactOrigins, allowlist.wildcardPatterns)) {
        callback(null, true);
      } else {
        logger.warn('CORS request rejected: origin not allowed', { requestOrigin });
        callback(null, false);
      }
    },
    credentials: true,
    exposedHeaders: ['Content-Range', 'Preference-Applied'],
  });
};
