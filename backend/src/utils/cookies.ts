import { Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';

/**
 * Set refresh token cookie on response
 */
export function setRefreshTokenCookie(res: Response, value: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * Clear refresh token cookie on response
 * IMPORTANT: Must use the same options (especially path) as when setting the cookie
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/auth',
  });
}
