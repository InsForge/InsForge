import crypto from 'crypto';

/**
 * CsrfManager - Handles CSRF token generation and verification
 * Infrastructure layer for CSRF protection
 *
 * Uses HMAC-based token derivation from refresh tokens for stateless verification.
 * This prevents CSRF attacks because:
 * 1. Attackers can't read cross-origin cookies (same-origin policy)
 * 2. Attackers can't compute the CSRF token without knowing the secret
 */
export class CsrfManager {
  private static secret: string | null = null;

  private static getSecret(): string {
    if (!this.secret) {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        throw new Error('JWT_SECRET is required for CSRF token generation');
      }
      this.secret = secret;
    }
    return this.secret;
  }

  /**
   * Generate a CSRF token derived from the refresh token using HMAC.
   * The token is returned in the response body and stored in a frontend-domain cookie.
   * On refresh requests, the SDK sends it in X-CSRF-Token header for validation.
   *
   * @param refreshToken - The refresh token to derive CSRF token from
   * @returns 32-character hex CSRF token
   */
  static generate(refreshToken: string): string {
    return crypto
      .createHmac('sha256', this.getSecret())
      .update(refreshToken)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Verify CSRF token against the expected value derived from refresh token.
   * Uses timing-safe comparison to prevent timing attacks.
   *
   * @param csrfToken - The CSRF token from X-CSRF-Token header
   * @param refreshToken - The refresh token from httpOnly cookie
   * @returns true if valid, false otherwise
   */
  static verify(csrfToken: string | undefined, refreshToken: string): boolean {
    if (!csrfToken) {
      return false;
    }
    const expected = this.generate(refreshToken);
    try {
      return crypto.timingSafeEqual(Buffer.from(csrfToken), Buffer.from(expected));
    } catch {
      // Buffers have different lengths
      return false;
    }
  }
}
