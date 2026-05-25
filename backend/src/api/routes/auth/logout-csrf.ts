import { TokenManager, type RefreshTokenPayload } from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

export interface WebLogoutCsrfInput {
  refreshToken?: string;
  csrfToken?: string;
}

export interface CsrfTokenVerifier {
  verifyRefreshToken(refreshToken: string): RefreshTokenPayload;
  verifyCsrfToken(csrfHeader: string | undefined, payload: RefreshTokenPayload): boolean;
}

export function assertValidWebLogoutCsrf(
  input: WebLogoutCsrfInput,
  tokenManager: CsrfTokenVerifier = TokenManager.getInstance()
): void {
  if (!input.refreshToken) {
    return;
  }

  let payload: RefreshTokenPayload;
  try {
    payload = tokenManager.verifyRefreshToken(input.refreshToken);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 401) {
      return;
    }
    throw error;
  }

  if (payload.sessionType !== 'user') {
    throw new AppError('Invalid refresh session type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
  }

  if (!tokenManager.verifyCsrfToken(input.csrfToken, payload)) {
    throw new AppError('Invalid CSRF token', 403, ERROR_CODES.AUTH_UNAUTHORIZED);
  }
}
