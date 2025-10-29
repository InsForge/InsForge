import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/core/database/manager.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type {
  EmailAuthConfigSchema,
  UpdateEmailAuthConfigRequest,
  PublicEmailAuthConfig,
} from '@insforge/shared-schemas';

export class AuthConfigService {
  private static instance: AuthConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('AuthConfigService initialized');
  }

  public static getInstance(): AuthConfigService {
    if (!AuthConfigService.instance) {
      AuthConfigService.instance = new AuthConfigService();
    }
    return AuthConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get public email authentication configuration (safe for public API)
   * Only returns non-sensitive configuration settings without id, timestamps, etc.
   */
  async getPublicEmailConfig(): Promise<PublicEmailAuthConfig> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar"
         FROM _auth_configs
         LIMIT 1`
      );

      // If no config exists, create default and return it
      if (!result.rows.length) {
        logger.warn('No auth config found, creating default configuration');
        const defaultConfig = await this.createDefaultConfig();
        return {
          requireEmailVerification: defaultConfig.requireEmailVerification,
          passwordMinLength: defaultConfig.passwordMinLength,
          requireNumber: defaultConfig.requireNumber,
          requireLowercase: defaultConfig.requireLowercase,
          requireUppercase: defaultConfig.requireUppercase,
          requireSpecialChar: defaultConfig.requireSpecialChar,
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get public auth config', { error });
      throw new AppError(
        'Failed to get email authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get email authentication configuration
   * Returns the singleton configuration row
   */
  async getEmailConfig(): Promise<EmailAuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
          id,
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_redirect_to as "verifyEmailRedirectTo",
          reset_password_redirect_to as "resetPasswordRedirectTo",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM _auth_configs
         LIMIT 1`
      );

      // If no config exists, create default and return it
      if (!result.rows.length) {
        logger.warn('No auth config found, creating default configuration');
        return await this.createDefaultConfig();
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get auth config', { error });
      throw new AppError(
        'Failed to get email authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  /**
   * Create default authentication configuration (idempotent and race-safe)
   * Uses UPSERT to handle concurrent cold starts gracefully
   * @param externalClient - Optional client to use (for transaction support)
   */
  private async createDefaultConfig(externalClient?: PoolClient): Promise<EmailAuthConfigSchema> {
    const client = externalClient || (await this.getPool().connect());
    const shouldReleaseClient = !externalClient;

    try {
      // Use ON CONFLICT DO NOTHING to make insert idempotent
      // The singleton constraint (idx_auth_configs_singleton) prevents duplicates
      const result = await client.query(
        `INSERT INTO _auth_configs (
          require_email_verification,
          password_min_length,
          require_number,
          require_lowercase,
          require_uppercase,
          require_special_char,
          verify_email_redirect_to,
          reset_password_redirect_to
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
        RETURNING
          id,
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_redirect_to as "verifyEmailRedirectTo",
          reset_password_redirect_to as "resetPasswordRedirectTo",
          created_at as "createdAt",
          updated_at as "updatedAt"`,
        [false, 6, false, false, false, false, null, null]
      );

      // If insert was skipped due to conflict (concurrent insert won the race),
      // read the existing row that was created by the other request
      if (result.rows.length === 0) {
        logger.info(
          'Default auth config already exists (concurrent creation), reading existing row'
        );
        const existingResult = await client.query(
          `SELECT
            id,
            require_email_verification as "requireEmailVerification",
            password_min_length as "passwordMinLength",
            require_number as "requireNumber",
            require_lowercase as "requireLowercase",
            require_uppercase as "requireUppercase",
            require_special_char as "requireSpecialChar",
            verify_email_redirect_to as "verifyEmailRedirectTo",
            reset_password_redirect_to as "resetPasswordRedirectTo",
            created_at as "createdAt",
            updated_at as "updatedAt"
           FROM _auth_configs
           LIMIT 1`
        );
        return existingResult.rows[0];
      }

      logger.info('Default auth config created');
      return result.rows[0];
    } catch (error) {
      logger.error('Failed to create default auth config', { error });
      throw new AppError(
        'Failed to create default authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      if (shouldReleaseClient) {
        client.release();
      }
    }
  }

  /**
   * Update email authentication configuration
   * Updates the singleton configuration row
   */
  async updateEmailConfig(input: UpdateEmailAuthConfigRequest): Promise<EmailAuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Ensure config exists and lock row to prevent concurrent modifications
      const existingResult = await client.query('SELECT id FROM _auth_configs LIMIT 1 FOR UPDATE');

      if (!existingResult.rows.length) {
        // Create default config if it doesn't exist, reusing the same client for transactional consistency
        await this.createDefaultConfig(client);
      }

      // Build update query
      const updates: string[] = [];
      const values: (string | number | boolean | null)[] = [];
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

      if (input.verifyEmailRedirectTo !== undefined) {
        updates.push(`verify_email_redirect_to = $${paramCount++}`);
        values.push(input.verifyEmailRedirectTo);
      }

      if (input.resetPasswordRedirectTo !== undefined) {
        updates.push(`reset_password_redirect_to = $${paramCount++}`);
        values.push(input.resetPasswordRedirectTo);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        // Return current config if no updates
        return await this.getEmailConfig();
      }

      // Add updated_at to updates
      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE _auth_configs
         SET ${updates.join(', ')}
         RETURNING
           id,
           require_email_verification as "requireEmailVerification",
           password_min_length as "passwordMinLength",
           require_number as "requireNumber",
           require_lowercase as "requireLowercase",
           require_uppercase as "requireUppercase",
           require_special_char as "requireSpecialChar",
           verify_email_redirect_to as "verifyEmailRedirectTo",
           reset_password_redirect_to as "resetPasswordRedirectTo",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        values
      );

      await client.query('COMMIT');
      logger.info('Auth config updated', { updatedFields: Object.keys(input) });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update auth config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to update email authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}
