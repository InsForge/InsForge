import crypto from 'crypto';
import type { CreateSessionResponse } from '@insforge/shared-schemas';
import { AppError } from '@/api/middlewares/error.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import { generateSecureToken } from '@/utils/utils.js';
import { AuthService } from './auth.service.js';

/**
 * Minimal data stored for each PKCE code.
 * User info and tokens are fetched/generated fresh during exchange.
 */
interface PKCECodeData {
  userId: string;
  provider: string;
  codeChallenge: string;
  expiresAt: Date;
}

/**
 * Service for managing OAuth PKCE (Proof Key for Code Exchange).
 *
 * This keeps OAuth callback URLs free of tokens by issuing a short-lived,
 * one-time exchange code after the provider callback succeeds.
 */
export class OAuthPKCEService {
  private static instance: OAuthPKCEService;

  private pkceCodes: Map<string, PKCECodeData> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private readonly CODE_BYTES = 32;
  private readonly CODE_EXPIRY_MINUTES = 5;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

  private constructor() {
    // Auto-cleanup expired codes every 5 minutes.
    this.cleanupInterval = setInterval(() => this.cleanupExpiredCodes(), this.CLEANUP_INTERVAL_MS);
    logger.info('OAuthPKCEService initialized');
  }

  public static getInstance(): OAuthPKCEService {
    if (!OAuthPKCEService.instance) {
      OAuthPKCEService.instance = new OAuthPKCEService();
    }
    return OAuthPKCEService.instance;
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.pkceCodes.clear();
    logger.info('OAuthPKCEService destroyed');
  }

  /**
   * Create a PKCE exchange code after successful OAuth authentication.
   */
  public createCode(data: { userId: string; codeChallenge: string; provider: string }): string {
    const code = generateSecureToken(this.CODE_BYTES);
    const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MINUTES * 60 * 1000);

    this.pkceCodes.set(code, {
      userId: data.userId,
      provider: data.provider,
      codeChallenge: data.codeChallenge,
      expiresAt,
    });

    logger.info('OAuth PKCE code created', {
      provider: data.provider,
      expiresAt: expiresAt.toISOString(),
    });

    return code;
  }

  /**
   * Exchange a PKCE code for session tokens after validating the code verifier.
   */
  public async exchangeCode(code: string, codeVerifier: string): Promise<CreateSessionResponse> {
    const data = this.pkceCodes.get(code);

    if (!data) {
      logger.warn('OAuth PKCE code not found or already used');
      throw new AppError('Invalid or expired code', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Delete immediately to make the code one-time use.
    this.pkceCodes.delete(code);

    if (new Date() > data.expiresAt) {
      logger.warn('OAuth PKCE code expired', { provider: data.provider });
      throw new AppError('Invalid or expired code', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Validate PKCE: SHA256(code_verifier) must equal the stored code_challenge.
    const computedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    if (computedChallenge !== data.codeChallenge) {
      logger.warn('PKCE validation failed', { provider: data.provider });
      throw new AppError('PKCE verification failed', 400, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const authService = AuthService.getInstance();
    const tokenManager = TokenManager.getInstance();

    const user = await authService.getUserSchemaById(data.userId);
    if (!user) {
      logger.error('User not found during PKCE exchange', { userId: data.userId });
      throw new AppError('User not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const accessToken = tokenManager.generateAccessToken({
      sub: user.id,
      email: user.email,
      role: 'authenticated',
    });

    logger.info('OAuth PKCE code successfully exchanged', { provider: data.provider });

    return {
      user,
      accessToken,
    };
  }

  /**
   * Remove expired codes from memory.
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
