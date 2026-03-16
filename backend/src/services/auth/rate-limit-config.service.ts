import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { RateLimitConfigSchema, UpdateRateLimitConfigRequest } from '@insforge/shared-schemas';

const DEFAULT_RATE_LIMIT_CONFIG = {
  sendEmailOtpMaxRequests: 5,
  sendEmailOtpWindowMinutes: 15,
  verifyOtpMaxAttempts: 10,
  verifyOtpWindowMinutes: 15,
  emailCooldownSeconds: 60,
} as const;

export class RateLimitConfigService {
  private static instance: RateLimitConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('RateLimitConfigService initialized');
  }

  public static getInstance(): RateLimitConfigService {
    if (!RateLimitConfigService.instance) {
      RateLimitConfigService.instance = new RateLimitConfigService();
    }
    return RateLimitConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private mapRowToSchema(row: {
    id: string;
    sendEmailOtpMaxRequests: number;
    sendEmailOtpWindowMinutes: number;
    verifyOtpMaxAttempts: number;
    verifyOtpWindowMinutes: number;
    emailCooldownSeconds: number;
    createdAt: string;
    updatedAt: string;
  }): RateLimitConfigSchema {
    return {
      id: row.id,
      sendEmailOtpMaxRequests: row.sendEmailOtpMaxRequests,
      sendEmailOtpWindowMinutes: row.sendEmailOtpWindowMinutes,
      verifyOtpMaxAttempts: row.verifyOtpMaxAttempts,
      verifyOtpWindowMinutes: row.verifyOtpWindowMinutes,
      emailCooldownSeconds: row.emailCooldownSeconds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async createDefaultConfig(client: PoolClient): Promise<RateLimitConfigSchema> {
    const result = await client.query(
      `INSERT INTO auth.rate_limit_configs (
         send_email_otp_max_requests,
         send_email_otp_window_minutes,
         verify_otp_max_attempts,
         verify_otp_window_minutes,
         email_cooldown_seconds
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id,
         send_email_otp_max_requests as "sendEmailOtpMaxRequests",
         send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
         verify_otp_max_attempts as "verifyOtpMaxAttempts",
         verify_otp_window_minutes as "verifyOtpWindowMinutes",
         email_cooldown_seconds as "emailCooldownSeconds",
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        DEFAULT_RATE_LIMIT_CONFIG.sendEmailOtpMaxRequests,
        DEFAULT_RATE_LIMIT_CONFIG.sendEmailOtpWindowMinutes,
        DEFAULT_RATE_LIMIT_CONFIG.verifyOtpMaxAttempts,
        DEFAULT_RATE_LIMIT_CONFIG.verifyOtpWindowMinutes,
        DEFAULT_RATE_LIMIT_CONFIG.emailCooldownSeconds,
      ]
    );

    return this.mapRowToSchema(result.rows[0]);
  }

  /**
   * Get rate-limit configuration.
   * Returns singleton row and lazily creates defaults if missing.
   */
  async getConfig(): Promise<RateLimitConfigSchema> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
           id,
           send_email_otp_max_requests as "sendEmailOtpMaxRequests",
           send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
           verify_otp_max_attempts as "verifyOtpMaxAttempts",
           verify_otp_window_minutes as "verifyOtpWindowMinutes",
           email_cooldown_seconds as "emailCooldownSeconds",
           created_at as "createdAt",
           updated_at as "updatedAt"
         FROM auth.rate_limit_configs
         LIMIT 1`
      );

      if (!result.rows.length) {
        logger.warn('No rate-limit config found, creating defaults');
        return await this.createDefaultConfig(client);
      }

      return this.mapRowToSchema(result.rows[0]);
    } catch (error) {
      logger.error('Failed to get rate-limit config', { error });
      throw new AppError('Failed to get rate-limit configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Update rate-limit configuration (singleton row).
   */
  async updateConfig(input: UpdateRateLimitConfigRequest): Promise<RateLimitConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT id FROM auth.rate_limit_configs LIMIT 1 FOR UPDATE'
      );

      if (!existingResult.rows.length) {
        await this.createDefaultConfig(client);
      }

      const updates: string[] = [];
      const values: number[] = [];
      let paramCount = 1;

      if (input.sendEmailOtpMaxRequests !== undefined) {
        updates.push(`send_email_otp_max_requests = $${paramCount++}`);
        values.push(input.sendEmailOtpMaxRequests);
      }

      if (input.sendEmailOtpWindowMinutes !== undefined) {
        updates.push(`send_email_otp_window_minutes = $${paramCount++}`);
        values.push(input.sendEmailOtpWindowMinutes);
      }

      if (input.verifyOtpMaxAttempts !== undefined) {
        updates.push(`verify_otp_max_attempts = $${paramCount++}`);
        values.push(input.verifyOtpMaxAttempts);
      }

      if (input.verifyOtpWindowMinutes !== undefined) {
        updates.push(`verify_otp_window_minutes = $${paramCount++}`);
        values.push(input.verifyOtpWindowMinutes);
      }

      if (input.emailCooldownSeconds !== undefined) {
        updates.push(`email_cooldown_seconds = $${paramCount++}`);
        values.push(input.emailCooldownSeconds);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        return await this.getConfig();
      }

      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE auth.rate_limit_configs
         SET ${updates.join(', ')}
         RETURNING
           id,
           send_email_otp_max_requests as "sendEmailOtpMaxRequests",
           send_email_otp_window_minutes as "sendEmailOtpWindowMinutes",
           verify_otp_max_attempts as "verifyOtpMaxAttempts",
           verify_otp_window_minutes as "verifyOtpWindowMinutes",
           email_cooldown_seconds as "emailCooldownSeconds",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        values
      );

      await client.query('COMMIT');
      logger.info('Rate-limit config updated', { updatedFields: Object.keys(input) });
      return this.mapRowToSchema(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update rate-limit config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to update rate-limit configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}

export { DEFAULT_RATE_LIMIT_CONFIG };
