import { Response } from 'express';
import { isCloudEnvironment } from './environment.js';

/**
 * Cookie configuration for refresh tokens
 * Following security best practices from the auth rework design document
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';

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
