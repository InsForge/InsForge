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
 * Minimal data stored for each exchange code
 * User info, tokens, and redirectTo are fetched/generated on exchange
 */
interface ExchangeCodeData {
  userId: string;
  codeChallenge: string;
  provider: string;
  expiresAt: Date;
}

/**
 * Service for managing OAuth PKCE code exchange
 *
 * This service implements a secure code exchange flow to prevent
 * exposing access tokens in URL parameters after OAuth authentication.
 *
 * Security properties:
 * - Exchange codes are high-entropy (256 bits)
 * - Codes are one-time use (deleted immediately after exchange)
 * - Codes expire after 5 minutes
 * - PKCE validation ensures only the original client can exchange the code
 *
 * Flow:
 * 1. After OAuth callback, createExchangeCode() stores session data with code_challenge
 * 2. Backend redirects to frontend with only the opaque exchange code
 * 3. Frontend calls exchangeCodeForTokens() with code + code_verifier
 * 4. Backend validates SHA256(code_verifier) === code_challenge
 * 5. Backend returns tokens in response body (not URL)
 */
export class OAuthExchangeService {
  private static instance: OAuthExchangeService;

  // In-memory storage for exchange codes
  private exchangeCodes: Map<string, ExchangeCodeData> = new Map();

  // Configuration
  private readonly CODE_BYTES = 32; // 32 bytes = 64 hex chars = 256 bits entropy
  private readonly CODE_EXPIRY_MINUTES = 5;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Auto-cleanup expired codes every 5 minutes
    setInterval(() => this.cleanupExpiredCodes(), this.CLEANUP_INTERVAL_MS);
    logger.info('OAuthExchangeService initialized');
  }

  public static getInstance(): OAuthExchangeService {
    if (!OAuthExchangeService.instance) {
      OAuthExchangeService.instance = new OAuthExchangeService();
    }
    return OAuthExchangeService.instance;
  }

  /**
   * Create an exchange code after successful OAuth authentication
   *
   * @param data - Minimal data to store (userId, codeChallenge, provider)
   * @returns The exchange code to include in redirect URL
   */
  createExchangeCode(data: { userId: string; codeChallenge: string; provider: string }): string {
    const code = generateSecureToken(this.CODE_BYTES);
    const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MINUTES * 60 * 1000);

    this.exchangeCodes.set(code, {
      userId: data.userId,
      codeChallenge: data.codeChallenge,
      provider: data.provider,
      expiresAt,
    });

    logger.info('OAuth exchange code created', {
      provider: data.provider,
      expiresAt: expiresAt.toISOString(),
    });

    return code;
  }

  /**
   * Exchange code for tokens with PKCE validation
   *
   * @param code - The exchange code from URL parameter
   * @param codeVerifier - The PKCE code verifier from frontend
   * @returns User and access token (fetched/generated fresh)
   * @throws AppError if code is invalid, expired, or PKCE validation fails
   */
  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<CreateSessionResponse> {
    const data = this.exchangeCodes.get(code);

    // Check if code exists
    if (!data) {
      logger.warn('OAuth exchange code not found or already used');
      throw new AppError('Invalid or expired exchange code', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Immediately delete to prevent replay attacks (one-time use)
    this.exchangeCodes.delete(code);

    // Check expiration
    if (new Date() > data.expiresAt) {
      logger.warn('OAuth exchange code expired', { provider: data.provider });
      throw new AppError('Invalid or expired exchange code', 400, ERROR_CODES.INVALID_INPUT);
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
      logger.error('User not found during OAuth exchange', { userId: data.userId });
      throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const accessToken = tokenManager.generateToken({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
    });
    const authConfig = await authConfigService.getAuthConfig();

    logger.info('OAuth exchange code successfully exchanged', { provider: data.provider });

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

    for (const [code, data] of this.exchangeCodes.entries()) {
      if (now > data.expiresAt) {
        this.exchangeCodes.delete(code);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Cleaned up expired OAuth exchange codes', { count: cleanedCount });
    }
  }
}
