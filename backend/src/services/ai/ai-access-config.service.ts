import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AIAccessConfigSchema, UpdateAIAccessConfigRequest } from '@insforge/shared-schemas';

// Cosmetic fallback used only by the admin read path when the table is empty.
// The access check path (`isAnonAiAccessAllowed`) fails closed instead.
const DEFAULT_CONFIG: AIAccessConfigSchema = {
  id: '00000000-0000-0000-0000-000000000000',
  allowAnonAiAccess: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Singleton service for reading/updating `ai.config`. */
export class AIAccessConfigService {
  private static instance: AIAccessConfigService;
  private pool: Pool | null = null;

  private constructor() {}

  public static getInstance(): AIAccessConfigService {
    if (!AIAccessConfigService.instance) {
      AIAccessConfigService.instance = new AIAccessConfigService();
    }
    return AIAccessConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /** Admin read path — returns a cosmetic fallback on read failure. */
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
          ...DEFAULT_CONFIG,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const row = result.rows[0];
      return {
        ...row,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
      };
    } catch (error) {
      logger.error('Failed to get AI access config, returning fallback values', { error });
      return {
        ...DEFAULT_CONFIG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Access-check path: returns whether anon-role JWTs may call AI endpoints.
   * Fails closed — propagates DB errors so the middleware can deny the request
   * instead of silently re-enabling access during a DB hiccup.
   */
  async isAnonAiAccessAllowed(): Promise<boolean> {
    const result = await this.getPool().query(
      `SELECT allow_anon_ai_access AS "allowAnonAiAccess" FROM ai.config LIMIT 1`
    );
    if (!result.rows.length) {
      // No row — default to allow (matches the column default and migration seed).
      return true;
    }
    return result.rows[0].allowAnonAiAccess === true;
  }

  async updateAIAccessConfig(input: UpdateAIAccessConfigRequest): Promise<AIAccessConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query('SELECT id FROM ai.config LIMIT 1 FOR UPDATE');

      let result;

      if (!existingResult.rows.length) {
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
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
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
