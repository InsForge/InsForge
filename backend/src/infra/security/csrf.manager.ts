import crypto from 'crypto';

/**
 * CsrfManager - Handles CSRF token generation and verification
 * Uses Double Submit Cookie pattern for stateless CSRF protection.
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
   */
  static generate(refreshToken: string): string {
    return crypto
      .createHmac('sha256', this.getSecret())
      .update(refreshToken)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Verify CSRF token by comparing header value with cookie value.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  static verify(csrfHeader: string | undefined, csrfCookie: string | undefined): boolean {
    if (!csrfHeader || !csrfCookie) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(csrfCookie));
    } catch {
      return false;
    }
  }
}
