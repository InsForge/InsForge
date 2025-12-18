import { Response } from 'express';
import { isProduction } from './environment';

/**
 * Cookie names
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';

/**
 * Set an auth cookie on response
 * @param name - Cookie name
 * @param value - Cookie value
 */
export function setAuthCookie(res: Response, name: string, value: string): void {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * Clear an auth cookie on response
 * IMPORTANT: Must use the same options (especially path) as when setting the cookie
 */
export function clearAuthCookie(res: Response, name: string): void {
  res.clearCookie(name, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
  });
}
