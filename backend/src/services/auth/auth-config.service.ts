import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';
import { RedirectValidationService } from './redirect-validation.service.js';

const AUTH_CONFIG_SELECT = `
  id,
  require_email_verification as "requireEmailVerification",
  password_min_length as "passwordMinLength",
  require_number as "requireNumber",
  require_lowercase as "requireLowercase",
  require_uppercase as "requireUppercase",
  require_special_char as "requireSpecialChar",
  verify_email_method as "verifyEmailMethod",
  reset_password_method as "resetPasswordMethod",
  sign_in_redirect_to as "signInRedirectTo",
  redirect_url_whitelist as "redirectUrlWhitelist",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

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
          redirect_url_whitelist as "redirectUrlWhitelist"
         FROM auth.configs
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
          redirectUrlWhitelist: [],
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
    try {
      const result = await this.getPool().query(`SELECT ${AUTH_CONFIG_SELECT} FROM auth.configs LIMIT 1`);

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
          signInRedirectTo: null,
          redirectUrlWhitelist: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      return result.rows[0];
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

      // Ensure config exists and lock row to prevent concurrent modifications
      let existingResult = await client.query(
        `SELECT ${AUTH_CONFIG_SELECT} FROM auth.configs LIMIT 1 FOR UPDATE`
      );

      if (!existingResult.rows.length) {
        logger.warn('Auth config row missing; creating default configuration row');
        await client.query(
          `INSERT INTO auth.configs (
             require_email_verification,
             password_min_length,
             require_number,
             require_lowercase,
             require_uppercase,
             require_special_char,
             verify_email_method,
             reset_password_method,
             sign_in_redirect_to,
             redirect_url_whitelist
           )
           VALUES (false, 6, false, false, false, false, 'code', 'code', null, ARRAY[]::TEXT[])`
        );

        existingResult = await client.query(
          `SELECT ${AUTH_CONFIG_SELECT} FROM auth.configs LIMIT 1 FOR UPDATE`
        );
      }

      const existingConfig = existingResult.rows[0] as AuthConfigSchema;
      const normalizedRedirectConfig = RedirectValidationService.validateAuthConfigOrThrow({
        signInRedirectTo:
          input.signInRedirectTo !== undefined
            ? input.signInRedirectTo
            : existingConfig.signInRedirectTo,
        redirectUrlWhitelist:
          input.redirectUrlWhitelist !== undefined
            ? input.redirectUrlWhitelist
            : existingConfig.redirectUrlWhitelist,
      });

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

      if (input.signInRedirectTo !== undefined) {
        updates.push(`sign_in_redirect_to = $${paramCount++}`);
        values.push(normalizedRedirectConfig.signInRedirectTo);
      }

      if (input.redirectUrlWhitelist !== undefined) {
        updates.push(`redirect_url_whitelist = $${paramCount++}`);
        values.push(normalizedRedirectConfig.redirectUrlWhitelist);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        // Return current config if no updates
        return await this.getAuthConfig();
      }

      // Add updated_at to updates
      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE auth.configs
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
           sign_in_redirect_to as "signInRedirectTo",
           redirect_url_whitelist as "redirectUrlWhitelist",
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
        'Failed to update authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}
