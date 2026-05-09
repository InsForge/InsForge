import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';
import { URL } from 'url';

export class AuthConfigService {
  private static instance: AuthConfigService;
  private pool: Pool | null = null;
  private configCache: { data: AuthConfigSchema; expiresAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 30_000;

  private constructor() {
    logger.info('AuthConfigService initialized');
  }

  public static getInstance(): AuthConfigService {
    if (!AuthConfigService.instance) {
      AuthConfigService.instance = new AuthConfigService();
    }
    return AuthConfigService.instance;
  }

  clearCache(): void {
    this.configCache = null;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get public authentication configuration (safe for public API)
   * Returns all configuration fields except metadata (id, created_at, updated_at)
   */
  async getPublicAuthConfig() {
    try {
      const result = await this.getPool().query(
        `SELECT
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_method as "verifyEmailMethod",
          reset_password_method as "resetPasswordMethod",
          verify_email_code_expiry_minutes as "verifyEmailCodeExpiryMinutes",
          verify_email_link_expiry_minutes as "verifyEmailLinkExpiryMinutes",
          reset_password_code_expiry_minutes as "resetPasswordCodeExpiryMinutes",
          reset_password_link_expiry_minutes as "resetPasswordLinkExpiryMinutes"
         FROM auth.config
         LIMIT 1`
      );

      // If no config exists, return fallback values
      if (!result.rows.length) {
        logger.warn('No auth config found, returning default fallback values');
        return {
          requireEmailVerification: false,
          passwordMinLength: 6,
          requireNumber: false,
          requireLowercase: false,
          requireUppercase: false,
          requireSpecialChar: false,
          verifyEmailMethod: 'code' as const,
          resetPasswordMethod: 'code' as const,
          verifyEmailCodeExpiryMinutes: 15,
          verifyEmailLinkExpiryMinutes: 1440,
          resetPasswordCodeExpiryMinutes: 10,
          resetPasswordLinkExpiryMinutes: 60,
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get public auth config', { error });
      throw new AppError(
        'Failed to get authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Get authentication configuration
   * Returns the singleton configuration row with all columns
   */
  async getAuthConfig(): Promise<AuthConfigSchema> {
    if (this.configCache && Date.now() < this.configCache.expiresAt) {
      return this.configCache.data;
    }

    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_method as "verifyEmailMethod",
          reset_password_method as "resetPasswordMethod",
          allowed_redirect_urls as "allowedRedirectUrls",
          verify_email_code_expiry_minutes as "verifyEmailCodeExpiryMinutes",
          verify_email_link_expiry_minutes as "verifyEmailLinkExpiryMinutes",
          reset_password_code_expiry_minutes as "resetPasswordCodeExpiryMinutes",
          reset_password_link_expiry_minutes as "resetPasswordLinkExpiryMinutes",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.config
         LIMIT 1`
      );

      // If no config exists, return fallback values
      if (!result.rows.length) {
        logger.warn('No auth config found, returning default fallback values');
        // Return a config with fallback values and generate a temporary ID
        return {
          id: '00000000-0000-0000-0000-000000000000',
          requireEmailVerification: false,
          passwordMinLength: 6,
          requireNumber: false,
          requireLowercase: false,
          requireUppercase: false,
          requireSpecialChar: false,
          verifyEmailMethod: 'code' as const,
          resetPasswordMethod: 'code' as const,
          allowedRedirectUrls: [],
          verifyEmailCodeExpiryMinutes: 15,
          verifyEmailLinkExpiryMinutes: 1440,
          resetPasswordCodeExpiryMinutes: 10,
          resetPasswordLinkExpiryMinutes: 60,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const config = result.rows[0];
      this.configCache = {
        data: config,
        expiresAt: Date.now() + AuthConfigService.CACHE_TTL_MS,
      };
      return config;
    } catch (error) {
      logger.error('Failed to get auth config', { error });
      throw new AppError(
        'Failed to get authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Update authentication configuration
   * Updates the singleton configuration row
   */
  async updateAuthConfig(input: UpdateAuthConfigRequest): Promise<AuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Ensure the singleton config row exists before we try to lock and update it.
      await client.query('INSERT INTO auth.config DEFAULT VALUES ON CONFLICT DO NOTHING');

      // Lock the singleton row to prevent concurrent modifications.
      const existingResult = await client.query('SELECT id FROM auth.config LIMIT 1 FOR UPDATE');

      if (!existingResult.rows.length) {
        // Config doesn't exist, rollback and throw error
        // The migration should have created the default config
        await client.query('ROLLBACK');
        throw new AppError(
          'Authentication configuration not found.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // Build update query
      const updates: string[] = [];
      const values: (string | number | boolean | null | string[])[] = [];
      let paramCount = 1;

      if (input.requireEmailVerification !== undefined) {
        updates.push(`require_email_verification = $${paramCount++}`);
        values.push(input.requireEmailVerification);
      }

      if (input.passwordMinLength !== undefined) {
        updates.push(`password_min_length = $${paramCount++}`);
        values.push(input.passwordMinLength);
      }

      if (input.requireNumber !== undefined) {
        updates.push(`require_number = $${paramCount++}`);
        values.push(input.requireNumber);
      }

      if (input.requireLowercase !== undefined) {
        updates.push(`require_lowercase = $${paramCount++}`);
        values.push(input.requireLowercase);
      }

      if (input.requireUppercase !== undefined) {
        updates.push(`require_uppercase = $${paramCount++}`);
        values.push(input.requireUppercase);
      }

      if (input.requireSpecialChar !== undefined) {
        updates.push(`require_special_char = $${paramCount++}`);
        values.push(input.requireSpecialChar);
      }

      if (input.verifyEmailMethod !== undefined) {
        updates.push(`verify_email_method = $${paramCount++}`);
        values.push(input.verifyEmailMethod);
      }

      if (input.resetPasswordMethod !== undefined) {
        updates.push(`reset_password_method = $${paramCount++}`);
        values.push(input.resetPasswordMethod);
      }

      if (input.allowedRedirectUrls !== undefined) {
        updates.push(`allowed_redirect_urls = $${paramCount++}::TEXT[]`);
        values.push(input.allowedRedirectUrls);
      }

      if (input.verifyEmailCodeExpiryMinutes !== undefined) {
        updates.push(`verify_email_code_expiry_minutes = $${paramCount++}`);
        values.push(input.verifyEmailCodeExpiryMinutes);
      }

      if (input.verifyEmailLinkExpiryMinutes !== undefined) {
        updates.push(`verify_email_link_expiry_minutes = $${paramCount++}`);
        values.push(input.verifyEmailLinkExpiryMinutes);
      }

      if (input.resetPasswordCodeExpiryMinutes !== undefined) {
        updates.push(`reset_password_code_expiry_minutes = $${paramCount++}`);
        values.push(input.resetPasswordCodeExpiryMinutes);
      }

      if (input.resetPasswordLinkExpiryMinutes !== undefined) {
        updates.push(`reset_password_link_expiry_minutes = $${paramCount++}`);
        values.push(input.resetPasswordLinkExpiryMinutes);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        // Return current config if no updates
        return await this.getAuthConfig();
      }

      // Add updated_at to updates
      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE auth.config
         SET ${updates.join(', ')}
         RETURNING
           id,
           require_email_verification as "requireEmailVerification",
           password_min_length as "passwordMinLength",
           require_number as "requireNumber",
           require_lowercase as "requireLowercase",
           require_uppercase as "requireUppercase",
           require_special_char as "requireSpecialChar",
           verify_email_method as "verifyEmailMethod",
           reset_password_method as "resetPasswordMethod",
           allowed_redirect_urls as "allowedRedirectUrls",
           verify_email_code_expiry_minutes as "verifyEmailCodeExpiryMinutes",
           verify_email_link_expiry_minutes as "verifyEmailLinkExpiryMinutes",
           reset_password_code_expiry_minutes as "resetPasswordCodeExpiryMinutes",
           reset_password_link_expiry_minutes as "resetPasswordLinkExpiryMinutes",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        values
      );

      await client.query('COMMIT');
      this.configCache = null;
      logger.info('Auth config updated', { updatedFields: Object.keys(input) });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update auth config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to update authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  /**
   * Normalizes a URL for comparison.
   * - Converts hostname to lowercase
   * - Removes default ports (handled by URL class)
   * - Removes trailing slash
   * Returns null if the URL is malformed.
   */
  private normalizeUrl(urlStr: string): string | null {
    try {
      const url = new URL(urlStr);
      return url.href.replace(/\/$/, '');
    } catch {
      // Reject malformed URL instead of returning lowercased string
      return null;
    }
  }

  /**
   * Validates a redirect URL against the server's configured allowed redirect URLs
   */
  async validateRedirectUrl(urlStr: string): Promise<boolean> {
    const config = await this.getAuthConfig();
    const allowedRedirectUrls = config.allowedRedirectUrls;

    // Use the configured allowed redirect URLs to validate the target URL.
    // If no whitelist is configured, we default to permissive behavior to improve
    // developer experience and lower development friction.
    if (!allowedRedirectUrls || allowedRedirectUrls.length === 0) {
      return true;
    }

    const targetUrl = this.normalizeUrl(urlStr);
    if (!targetUrl) {
      return false;
    }

    let targetUrlObj: URL;
    try {
      targetUrlObj = new URL(targetUrl);
    } catch {
      return false;
    }

    return allowedRedirectUrls.some((item) => {
      if (!item.includes('*.')) {
        return this.normalizeUrl(item) === targetUrl;
      }

      try {
        const dummyPrefix = '__wildcard__.';
        const normalizedItem = this.normalizeUrl(item.replace('*.', dummyPrefix));
        if (!normalizedItem) {
          return false;
        }
        const parsedItem = new URL(normalizedItem);

        if (parsedItem.protocol !== targetUrlObj.protocol) {
          return false;
        }
        if (parsedItem.port !== targetUrlObj.port) {
          return false;
        }
        if (parsedItem.pathname !== '/' && parsedItem.pathname !== targetUrlObj.pathname) {
          return false;
        }

        const baseDomain = parsedItem.hostname.replace(dummyPrefix, '');

        return targetUrlObj.hostname.endsWith('.' + baseDomain);
      } catch {
        return false;
      }
    });
  }
}
