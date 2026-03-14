import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type {
  RealtimeMessageRetentionConfig,
  UpdateRealtimeMessageRetentionRequest,
} from '@insforge/shared-schemas';

export class RealtimeConfigService {
  private static instance: RealtimeConfigService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeConfigService {
    if (!RealtimeConfigService.instance) {
      RealtimeConfigService.instance = new RealtimeConfigService();
    }
    return RealtimeConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async getMessageRetentionConfig(): Promise<RealtimeMessageRetentionConfig> {
    const result = await this.getPool().query(
      `SELECT
        cleanup_enabled as "enabled",
        message_retention_days as "retentionDays",
        cleanup_batch_size as "cleanupBatchSize",
        cleanup_schedule as "cleanupSchedule",
        cron_job_id as "cronJobId",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM realtime.configs
      WHERE singleton = TRUE
      LIMIT 1`
    );

    const config = result.rows[0];
    if (!config) {
      throw new AppError(
        'Realtime retention configuration not found. Please run migrations.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return config;
  }

  async updateMessageRetentionConfig(
    input: UpdateRealtimeMessageRetentionRequest
  ): Promise<RealtimeMessageRetentionConfig> {
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT id FROM realtime.configs WHERE singleton = TRUE LIMIT 1 FOR UPDATE'
      );

      if (!existingResult.rows.length) {
        throw new AppError(
          'Realtime retention configuration not found. Please run migrations.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const updates: string[] = [];
      const values: (boolean | number)[] = [];
      let paramIndex = 1;

      if (input.enabled !== undefined) {
        updates.push(`cleanup_enabled = $${paramIndex++}`);
        values.push(input.enabled);
      }

      if (input.retentionDays !== undefined) {
        updates.push(`message_retention_days = $${paramIndex++}`);
        values.push(input.retentionDays);
      }

      if (updates.length) {
        updates.push('updated_at = NOW()');
        await client.query(
          `UPDATE realtime.configs SET ${updates.join(', ')} WHERE singleton = TRUE`,
          values
        );
      }

      await client.query('SELECT realtime.sync_message_cleanup_schedule()');
      await client.query('COMMIT');

      logger.info('Realtime message retention updated', {
        updatedFields: Object.keys(input),
      });

      return await this.getMessageRetentionConfig();
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error('Failed to update realtime message retention', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        'Failed to update realtime message retention configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  async runMessageCleanup(): Promise<number> {
    const result = await this.getPool().query(
      'SELECT realtime.cleanup_messages() as "deletedCount"'
    );

    return Number(result.rows[0]?.deletedCount || 0);
  }
}
