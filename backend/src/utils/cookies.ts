import { Response } from 'express';
import { isCloudEnvironment } from './environment.js';
import { TokenManager } from '@/infra/security/token.manager.js';

/**
 * Cookie configuration for refresh tokens
 * Following security best practices from the auth rework design document
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';

/**
 * Cookie name for authentication flag
 * This is a non-httpOnly cookie that signals to the SDK that a refresh token exists
 * Used by SDK to detect secure session mode and attempt token refresh on page reload
 */
export const AUTH_FLAG_COOKIE_NAME = 'isAuthenticated';

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
 * Cookie options for auth flag
 * - httpOnly: false (must be accessible to JavaScript for SDK detection)
 * - secure: HTTPS only in production
 * - sameSite: 'lax' for all environments (doesn't need cross-origin)
 * - path: '/' - Accessible from all paths
 * - maxAge: 7 days (same as refresh token)
 */
export function getAuthFlagCookieOptions() {
  const isCloud = isCloudEnvironment();
  return {
    httpOnly: false, // SDK needs to read this
    secure: isCloud,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
}

/**
 * Set refresh token cookie on response
 * Also sets the auth flag cookie to signal SDK that secure session is active
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());
  res.cookie(AUTH_FLAG_COOKIE_NAME, 'true', getAuthFlagCookieOptions());
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
  res.clearCookie(AUTH_FLAG_COOKIE_NAME, {
    httpOnly: false,
    secure: isCloud,
    sameSite: 'lax' as const,
    path: '/',
  });
}

/**
 * Issue refresh token cookie for authenticated user
 * Generates refresh token and sets both refresh token and auth flag cookies
 *
 * @param res - Express response object
 * @param user - User object with id and email
 * @returns void - Only issues cookie if user has valid id and email
 */
export function issueRefreshTokenCookie(res: Response, user: { id: string; email: string }): void {
  if (!user?.id || !user?.email) {
    return;
  }

  const tokenManager = TokenManager.getInstance();
  const refreshToken = tokenManager.generateRefreshToken({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
  });
  setRefreshTokenCookie(res, refreshToken);
}
