import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { OpenRouterProvider, BYOK_SECRET_KEY } from '@/providers/ai/openrouter.provider.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { GatewayConfigResponse } from '@insforge/shared-schemas';

export class AIGatewayConfigService {
  private static instance: AIGatewayConfigService;

  private constructor() {}

  static getInstance(): AIGatewayConfigService {
    if (!AIGatewayConfigService.instance) {
      AIGatewayConfigService.instance = new AIGatewayConfigService();
    }
    return AIGatewayConfigService.instance;
  }

  /**
   * Get the current gateway credential configuration.
   * Returns which key source is active and a masked preview of the BYOK key if set.
   */
  async getConfig(): Promise<GatewayConfigResponse> {
    const secretService = SecretService.getInstance();
    const byokKey = await secretService.getSecretByKey(BYOK_SECRET_KEY);

    if (byokKey) {
      return {
        keySource: 'byok',
        hasByokKey: true,
        maskedKey: this.maskKey(byokKey),
      };
    }

    if (isCloudEnvironment()) {
      return { keySource: 'cloud', hasByokKey: false };
    }

    if (process.env.OPENROUTER_API_KEY) {
      return { keySource: 'env', hasByokKey: false };
    }

    return { keySource: 'unconfigured', hasByokKey: false };
  }

  /**
   * Store or replace the BYOK OpenRouter API key.
   * Validates the key against OpenRouter before saving.
   */
  async setBYOKKey(apiKey: string): Promise<void> {
    await this.validateOpenRouterKey(apiKey);

    const pool = DatabaseManager.getInstance().getPool();
    const encryptedValue = EncryptionManager.encrypt(apiKey);

    // Upsert: insert new or update existing (including previously removed/inactive)
    await pool.query(
      `INSERT INTO system.secrets (key, value_ciphertext, is_active, is_reserved)
       VALUES ($1, $2, true, false)
       ON CONFLICT (key) DO UPDATE SET
         value_ciphertext = EXCLUDED.value_ciphertext,
         is_active = true,
         updated_at = NOW()`,
      [BYOK_SECRET_KEY, encryptedValue]
    );

    // Clear provider cache so it picks up the new key immediately
    OpenRouterProvider.getInstance().clearKeyCache();

    logger.info('BYOK OpenRouter API key configured');
  }

  /**
   * Remove the BYOK OpenRouter API key, reverting to the default key source.
   */
  async removeBYOKKey(): Promise<boolean> {
    const pool = DatabaseManager.getInstance().getPool();

    const result = await pool.query(`DELETE FROM system.secrets WHERE key = $1`, [BYOK_SECRET_KEY]);

    const removed = (result.rowCount ?? 0) > 0;

    if (removed) {
      OpenRouterProvider.getInstance().clearKeyCache();
      logger.info('BYOK OpenRouter API key removed');
    }

    return removed;
  }

  /**
   * Validate an OpenRouter API key by calling the /key info endpoint.
   * Throws AppError if the key is invalid.
   */
  private async validateOpenRouterKey(apiKey: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/key', {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new AppError(
          'Invalid OpenRouter API key. Please check the key and try again.',
          400,
          ERROR_CODES.AI_INVALID_API_KEY
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Could not validate OpenRouter API key. Check your network connection and try again.',
        400,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
  }

  private maskKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '****';
    }
    return apiKey.substring(0, 4) + '****' + apiKey.substring(apiKey.length - 4);
  }
}
