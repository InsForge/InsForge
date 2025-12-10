import { Response } from 'express';
import { isCloudEnvironment } from './environment.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { CsrfManager } from '@/infra/security/csrf.manager.js';

/**
 * Cookie configuration for refresh tokens
 * Following security best practices from the auth rework design document
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';
export const CSRF_TOKEN_COOKIE_NAME = 'insforge_csrf_token';

/**
 * Cookie options for refresh token
 * - httpOnly: JavaScript cannot access (XSS protection)
 * - secure: HTTPS only in production
 * - sameSite: 'none' for cross-origin requests in production, 'lax' in development
 * - path: '/api/auth' - Only sent to auth endpoints (reduces attack surface)
 * - maxAge: 7 days
 */
export function getRefreshTokenCookieOptions() {
  const isCloud = isCloudEnvironment();
  return {
    httpOnly: true,
    secure: isCloud,
    sameSite: isCloud ? ('none' as const) : ('lax' as const),
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
}

/**
 * Set refresh token cookie on response
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());
}

/**
 * Clear refresh token cookie on response
 * IMPORTANT: Must use the same options (especially path) as when setting the cookie
 */
export function clearRefreshTokenCookie(res: Response): void {
  const isCloud = isCloudEnvironment();
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: isCloud,
    sameSite: isCloud ? ('none' as const) : ('lax' as const),
    path: '/api/auth',
  });
}

/**
 * Cookie options for CSRF token
 * - httpOnly: false - Frontend needs to read it for header
 * - secure: HTTPS only in production
 * - sameSite: 'none' for cross-origin requests in production, 'lax' in development
 * - path: '/api/auth' - Only sent to auth endpoints
 * - maxAge: 7 days (same as refresh token)
 */
export function getCsrfTokenCookieOptions() {
  const isCloud = isCloudEnvironment();
  return {
    httpOnly: false, // Frontend needs to read this
    secure: isCloud,
    sameSite: isCloud ? ('none' as const) : ('lax' as const),
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/**
 * Set CSRF token cookie on response
 */
export function setCsrfTokenCookie(res: Response, csrfToken: string): void {
  res.cookie(CSRF_TOKEN_COOKIE_NAME, csrfToken, getCsrfTokenCookieOptions());
}

/**
 * Clear CSRF token cookie on response
 */
export function clearCsrfTokenCookie(res: Response): void {
  const isCloud = isCloudEnvironment();
  res.clearCookie(CSRF_TOKEN_COOKIE_NAME, {
    httpOnly: false,
    secure: isCloud,
    sameSite: isCloud ? ('none' as const) : ('lax' as const),
    path: '/api/auth',
  });
}

/**
 * Issue refresh token cookie for authenticated user
 * Generates refresh token, sets httpOnly cookie, and returns CSRF token
 *
 * @param res - Express response object
 * @param user - User object with id and email
 * @returns csrfToken - The CSRF token to include in response body, or null if user is invalid
 */
export function issueRefreshTokenCookie(
  res: Response,
  user: { id: string; email: string }
): string | null {
  if (!user?.id || !user?.email) {
    return null;
  }

  const tokenManager = TokenManager.getInstance();
  const refreshToken = tokenManager.generateRefreshToken({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
  });
  setRefreshTokenCookie(res, refreshToken);

  // Generate and set CSRF token cookie
  const csrfToken = CsrfManager.generate(refreshToken);
  setCsrfTokenCookie(res, csrfToken);

  return csrfToken;
}
