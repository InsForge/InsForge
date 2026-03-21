import { URL } from 'url';

/**
 * Normalizes a URL for comparison.
 * - Converts hostname to lowercase
 * - Removes default ports (handled by URL class)
 * - Removes trailing slash
 */
export function normalizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return url.href.replace(/\/$/, '');
  } catch {
    // If invalid URL, return as is after trimming and lowercasing
    return urlStr.trim().toLowerCase().replace(/\/$/, '');
  }
}

/**
 * Validates a redirect URL against a whitelist.
 * If the whitelist is empty, it returns true (permissive fallback).
 */
export function validateRedirectUrl(url: string, whitelist?: string[] | null): boolean {
  if (!whitelist || whitelist.length === 0) {
    return true;
  }

  const normalizedUrl = normalizeUrl(url);
  return whitelist.some((item) => normalizeUrl(item) === normalizedUrl);
}
