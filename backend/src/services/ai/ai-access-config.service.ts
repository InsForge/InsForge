import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AIAccessConfigSchema, UpdateAIAccessConfigRequest } from '@insforge/shared-schemas';

/**
 * Singleton service responsible for reading and updating the AI access
 * configuration persisted in the `ai.config` database table.
 *
 * The `allow_anon_ai_access` flag controls whether anonymous (API-key) tokens
 * are permitted to call AI endpoints.  It defaults to `true` so that existing
 * projects are not affected by the migration that introduces this table.
 */
export class AIAccessConfigService {
  private static instance: AIAccessConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('AIAccessConfigService initialized');
  }

  /**
   * Returns the singleton AIAccessConfigService instance,
   * creating it on first access.
   */
  public static getInstance(): AIAccessConfigService {
    if (!AIAccessConfigService.instance) {
      AIAccessConfigService.instance = new AIAccessConfigService();
    }
    return AIAccessConfigService.instance;
  }

  /**
   * Returns the lazily-initialized database connection pool.
   */
  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Retrieves the AI access configuration from the database.
   * Returns the singleton row, or a safe fallback (anon access allowed) when
   * the table is empty or the query fails, so that a missing migration never
   * breaks existing behaviour.
   */
  async getAIAccessConfig(): Promise<AIAccessConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          allow_anon_ai_access AS "allowAnonAiAccess",
          created_at           AS "createdAt",
          updated_at           AS "updatedAt"
         FROM ai.config
         LIMIT 1`
      );

      if (!result.rows.length) {
        logger.warn('No AI access config found, returning default fallback values');
        return {
          id: '00000000-0000-0000-0000-000000000000',
          allowAnonAiAccess: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const row = result.rows[0];
      return {
        ...row,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      };
    } catch (error) {
      logger.error('Failed to get AI access config, returning fallback values', { error });
      return {
        id: '00000000-0000-0000-0000-000000000000',
        allowAnonAiAccess: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Returns `true` when anonymous (API-key) tokens are allowed to call AI
   * endpoints, `false` otherwise.
   * Falls back to `true` on any database error to preserve existing behaviour.
   */
  async isAnonAiAccessAllowed(): Promise<boolean> {
    try {
      const config = await this.getAIAccessConfig();
      return config.allowAnonAiAccess;
    } catch {
      return true;
    }
  }

  /**
   * Updates the AI access configuration with the provided values.
   * If the singleton row does not yet exist (e.g. migration was not run),
   * it will be created automatically via an INSERT instead of failing.
   */
  async updateAIAccessConfig(input: UpdateAIAccessConfigRequest): Promise<AIAccessConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query('SELECT id FROM ai.config LIMIT 1 FOR UPDATE');

      let result;

      if (!existingResult.rows.length) {
        // Singleton row is missing — create it with the requested value
        result = await client.query(
          `INSERT INTO ai.config (allow_anon_ai_access)
           VALUES ($1)
           RETURNING
             id,
             allow_anon_ai_access AS "allowAnonAiAccess",
             created_at           AS "createdAt",
             updated_at           AS "updatedAt"`,
          [input.allowAnonAiAccess]
        );
      } else {
        const existingId = existingResult.rows[0].id as string;
        result = await client.query(
          `UPDATE ai.config
           SET allow_anon_ai_access = $1, updated_at = NOW()
           WHERE id = $2
           RETURNING
             id,
             allow_anon_ai_access AS "allowAnonAiAccess",
             created_at           AS "createdAt",
             updated_at           AS "updatedAt"`,
          [input.allowAnonAiAccess, existingId]
        );
      }

      await client.query('COMMIT');
      logger.info('AI access config updated', { allowAnonAiAccess: input.allowAnonAiAccess });
      const row = result.rows[0];
      return {
        ...row,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed', { rollbackError });
      }
      logger.error('Failed to update AI access config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to update AI access configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}
