import { Response } from 'express';
import crypto from 'crypto';
import { isCloudEnvironment } from './environment.js';
import { TokenManager } from '@/infra/security/token.manager.js';

/**
 * Cookie configuration for refresh tokens
 * Following security best practices from the auth rework design document
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'insforge_refresh_token';

/**
 * CSRF Token Generation
 *
 * Generates a CSRF token derived from the refresh token using HMAC.
 * This allows stateless verification - no need to store CSRF tokens separately.
 *
 * The CSRF token is returned in the response body, and the SDK stores it
 * in a frontend-domain cookie. On refresh requests, the SDK sends it in
 * the X-CSRF-Token header, which is validated against HMAC(refreshToken).
 *
 * This prevents CSRF attacks because:
 * 1. Attackers can't read cross-origin cookies (same-origin policy)
 * 2. Attackers can't compute the CSRF token without knowing the secret
 */
export function generateCsrfToken(refreshToken: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required for CSRF token generation');
  }
  return crypto.createHmac('sha256', secret).update(refreshToken).digest('hex').substring(0, 32);
}

/**
 * Verify CSRF Token
 *
 * Validates that the provided CSRF token matches the expected value
 * derived from the refresh token.
 *
 * @param csrfToken - The CSRF token from X-CSRF-Token header
 * @param refreshToken - The refresh token from httpOnly cookie
 * @returns true if valid, false otherwise
 */
export function verifyCsrfToken(csrfToken: string | undefined, refreshToken: string): boolean {
  if (!csrfToken) {
    return false;
  }
  const expectedToken = generateCsrfToken(refreshToken);
  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(csrfToken), Buffer.from(expectedToken));
  } catch {
    // Buffers have different lengths
    return false;
  }
}

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

  // Return CSRF token for response body (SDK will store in frontend cookie)
  return generateCsrfToken(refreshToken);
}
