import crypto from 'crypto';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import logger from '@/utils/logger.js';
import { generateSecureToken } from '@/utils/utils.js';
import type { CreateSessionResponse } from '@insforge/shared-schemas';
import { AuthService } from './auth.service.js';
import { AuthConfigService } from './auth-config.service.js';

/**
 * Minimal data stored for each PKCE code
 * User info, tokens, and redirectTo are fetched/generated on exchange
 */
interface PKCECodeData {
  userId: string;
  codeChallenge: string;
  provider: string;
  expiresAt: Date;
}

/**
 * Service for managing OAuth PKCE (Proof Key for Code Exchange)
 *
 * This service implements a secure PKCE flow to prevent exposing
 * access tokens in URL parameters after OAuth authentication.
 *
 * Security properties:
 * - Codes are high-entropy (256 bits)
 * - Codes are one-time use (deleted immediately after exchange)
 * - Codes expire after 5 minutes
 * - PKCE validation ensures only the original client can exchange the code
 *
 * Flow:
 * 1. After OAuth callback, createCode() stores session data with code_challenge
 * 2. Backend redirects to frontend with only the opaque code
 * 3. Frontend calls exchangeCode() with code + code_verifier
 * 4. Backend validates SHA256(code_verifier) === code_challenge
 * 5. Backend returns tokens in response body (not URL)
 */
export class OAuthPKCEService {
  private static instance: OAuthPKCEService;

  // In-memory storage for PKCE codes
  private pkceCodes: Map<string, PKCECodeData> = new Map();

  // Cleanup interval reference (for graceful shutdown)
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly CODE_BYTES = 32; // 32 bytes = 64 hex chars = 256 bits entropy
  private readonly CODE_EXPIRY_MINUTES = 5;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Auto-cleanup expired codes every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupExpiredCodes(), this.CLEANUP_INTERVAL_MS);
    logger.info('OAuthPKCEService initialized');
  }

  public static getInstance(): OAuthPKCEService {
    if (!OAuthPKCEService.instance) {
      OAuthPKCEService.instance = new OAuthPKCEService();
    }
    return OAuthPKCEService.instance;
  }

  /**
   * Clean up resources for graceful shutdown
   * Clears the cleanup interval and removes all stored codes
   */
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pkceCodes.clear();
    logger.info('OAuthPKCEService destroyed');
  }

  /**
   * Create a PKCE code after successful OAuth authentication
   *
   * @param data - Minimal data to store (userId, codeChallenge, provider)
   * @returns The code to include in redirect URL
   */
  createCode(data: { userId: string; codeChallenge: string; provider: string }): string {
    const code = generateSecureToken(this.CODE_BYTES);
    const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MINUTES * 60 * 1000);

    this.pkceCodes.set(code, {
      userId: data.userId,
      codeChallenge: data.codeChallenge,
      provider: data.provider,
      expiresAt,
    });

    logger.info('OAuth PKCE code created', {
      provider: data.provider,
      expiresAt: expiresAt.toISOString(),
    });

    return code;
  }

  /**
   * Exchange code for tokens with PKCE validation
   *
   * @param code - The PKCE code from URL parameter
   * @param codeVerifier - The code verifier from frontend
   * @returns User and access token (fetched/generated fresh)
   * @throws AppError if code is invalid, expired, or PKCE validation fails
   */
  async exchangeCode(code: string, codeVerifier: string): Promise<CreateSessionResponse> {
    const data = this.pkceCodes.get(code);

    // Check if code exists
    if (!data) {
      logger.warn('OAuth PKCE code not found or already used');
      throw new AppError('Invalid or expired code', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Immediately delete to prevent replay attacks (one-time use)
    this.pkceCodes.delete(code);

    // Check expiration
    if (new Date() > data.expiresAt) {
      logger.warn('OAuth PKCE code expired', { provider: data.provider });
      throw new AppError('Invalid or expired code', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Validate PKCE: SHA256(code_verifier) should equal code_challenge
    const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    if (computedChallenge !== data.codeChallenge) {
      logger.warn('PKCE validation failed', { provider: data.provider });
      throw new AppError('PKCE verification failed', 400, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    // Fetch user and generate fresh token
    const authService = AuthService.getInstance();
    const authConfigService = AuthConfigService.getInstance();
    const tokenManager = TokenManager.getInstance();

    const user = await authService.getUserSchemaById(data.userId);
    if (!user) {
      logger.error('User not found during PKCE exchange', { userId: data.userId });
      throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const accessToken = tokenManager.generateToken({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
    });
    const authConfig = await authConfigService.getAuthConfig();

    logger.info('OAuth PKCE code successfully exchanged', { provider: data.provider });

    return {
      user,
      accessToken,
      redirectTo: authConfig.signInRedirectTo || undefined,
    };
  }

  /**
   * Remove expired codes from memory
   * Called automatically every 5 minutes
   */
  private cleanupExpiredCodes(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [code, data] of this.pkceCodes.entries()) {
      if (now > data.expiresAt) {
        this.pkceCodes.delete(code);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired OAuth PKCE codes', { count: cleanedCount });
    }
  }
}
