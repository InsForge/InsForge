import { Request } from 'express';
import {
  TokenManager,
  type RefreshSessionType,
  type RefreshTokenPayload,
} from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * CSRF guard for cookie-based logout.
 *
 * Throws 403 only when the refresh cookie holds a valid token of the expected
 * session type but the X-CSRF-Token header does not match. Missing, expired,
 * invalid, or wrong-session-type cookies pass through so the caller can clear
 * them idempotently.
 */
export function assertLogoutCsrf(
  req: Request,
  cookieName: string,
  sessionType: RefreshSessionType,
  logTag: string
): void {
  const refreshToken = req.cookies?.[cookieName];
  if (!refreshToken) {
    return;
  }

  const tokenManager = TokenManager.getInstance();
  let payload: RefreshTokenPayload;
  try {
    payload = tokenManager.verifyRefreshToken(refreshToken);
  } catch {
    return;
  }

  if (payload.sessionType !== sessionType) {
    return;
  }

  const csrfHeader = req.headers['x-csrf-token'];
  const csrfToken = typeof csrfHeader === 'string' ? csrfHeader : undefined;
  if (!tokenManager.verifyCsrfToken(csrfToken, payload)) {
    logger.warn(`[${logTag}] CSRF token validation failed`);
    throw new AppError('Invalid CSRF token', 403, ERROR_CODES.FORBIDDEN);
  }
}
