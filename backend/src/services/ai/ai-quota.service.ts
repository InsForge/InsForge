import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';

export interface QuotaConfig {
  id: string;
  userId: string | null;
  maxRequestsPerDay: number | null;
  maxTokensPerDay: number | null;
  maxTokensPerMonth: number | null;
  maxSpendUsdPerMonth: number | null;
  allowedModels: string[] | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertQuotaConfigInput {
  userId: string | null;
  maxRequestsPerDay?: number | null;
  maxTokensPerDay?: number | null;
  maxTokensPerMonth?: number | null;
  maxSpendUsdPerMonth?: number | null;
  allowedModels?: string[] | null;
  isEnabled?: boolean;
}

/**
 * AIQuotaService — manages per-user and global default quota configurations.
 */
export class AIQuotaService {
  private static instance: AIQuotaService;
  private pool: Pool;

  private constructor() {
    this.pool = DatabaseManager.getInstance().getPool();
  }

  public static getInstance(): AIQuotaService {
    if (!AIQuotaService.instance) {
      AIQuotaService.instance = new AIQuotaService();
    }
    return AIQuotaService.instance;
  }

  /**
   * Get the effective quota config for a user.
   * Falls back to global default if no per-user config exists.
   */
  async getEffectiveQuota(userId: string): Promise<QuotaConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM ai.quota_configs
       WHERE user_id = $1 OR user_id IS NULL
       ORDER BY user_id NULLS LAST
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Get global default quota config.
   */
  async getGlobalDefault(): Promise<QuotaConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM ai.quota_configs WHERE user_id IS NULL LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Get quota config for a specific user (not fallback).
   */
  async getUserQuota(userId: string): Promise<QuotaConfig | null> {
    const result = await this.pool.query(
      `SELECT * FROM ai.quota_configs WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * List all quota configs (admin).
   */
  async listQuotas(options: {
    limit?: number;
    offset?: number;
  }): Promise<{ data: QuotaConfig[]; total: number }> {
    const { limit = 50, offset = 0 } = options;

    const countResult = await this.pool.query(`SELECT COUNT(*) AS total FROM ai.quota_configs`);
    const dataResult = await this.pool.query(
      `SELECT * FROM ai.quota_configs
       ORDER BY user_id NULLS FIRST, created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      data: dataResult.rows.map((row) => this.mapRow(row)),
      total: parseInt(countResult.rows[0]?.total || '0'),
    };
  }

  /**
   * Create or update a quota config.
   */
  async upsertQuota(input: UpsertQuotaConfigInput): Promise<QuotaConfig> {
    const result = await this.pool.query(
      `INSERT INTO ai.quota_configs
        (user_id, max_requests_per_day, max_tokens_per_day, max_tokens_per_month, max_spend_usd_per_month, allowed_models, is_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id)
       DO UPDATE SET
        max_requests_per_day = EXCLUDED.max_requests_per_day,
        max_tokens_per_day = EXCLUDED.max_tokens_per_day,
        max_tokens_per_month = EXCLUDED.max_tokens_per_month,
        max_spend_usd_per_month = EXCLUDED.max_spend_usd_per_month,
        allowed_models = EXCLUDED.allowed_models,
        is_enabled = EXCLUDED.is_enabled,
        updated_at = NOW()
       RETURNING *`,
      [
        input.userId,
        input.maxRequestsPerDay ?? null,
        input.maxTokensPerDay ?? null,
        input.maxTokensPerMonth ?? null,
        input.maxSpendUsdPerMonth ?? null,
        input.allowedModels ?? null,
        input.isEnabled ?? true,
      ]
    );

    logger.info('AI quota config upserted', { userId: input.userId });
    return this.mapRow(result.rows[0]);
  }

  /**
   * Delete a per-user quota config (reverts to global default).
   */
  async deleteUserQuota(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ai.quota_configs WHERE user_id = $1`,
      [userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: Record<string, unknown>): QuotaConfig {
    return {
      id: row.id as string,
      userId: row.user_id as string | null,
      maxRequestsPerDay: row.max_requests_per_day as number | null,
      maxTokensPerDay: row.max_tokens_per_day as number | null,
      maxTokensPerMonth: row.max_tokens_per_month as number | null,
      maxSpendUsdPerMonth: row.max_spend_usd_per_month != null ? parseFloat(String(row.max_spend_usd_per_month)) : null,
      allowedModels: row.allowed_models as string[] | null,
      isEnabled: row.is_enabled as boolean,
      createdAt: (row.created_at as Date).toISOString(),
      updatedAt: (row.updated_at as Date).toISOString(),
    };
  }
}
