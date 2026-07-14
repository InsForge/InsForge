import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

const AI_ENDPOINTS = ['chat', 'image', 'embedding'] as const;
export type AIEndpoint = (typeof AI_ENDPOINTS)[number];

interface UsageLogRow {
  id: string;
  user_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost: number;
  endpoint: string;
  created_at: string;
}

interface QuotaConfigRow {
  id: string;
  user_id: string | null;
  max_requests_per_day: number | null;
  max_tokens_per_day: number | null;
  max_tokens_per_month: number | null;
  monthly_spend_cap_usd: number | null;
  model_allowlist: string[] | null;
  updated_at: string;
}

interface UsageAggregate {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  request_count: number;
}

interface UsageByUserAndModel {
  user_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  request_count: number;
}

export class AIUsageService {
  private static instance: AIUsageService;
  private pool: Pool | null = null;

  private constructor() {}

  public static getInstance(): AIUsageService {
    if (!AIUsageService.instance) {
      AIUsageService.instance = new AIUsageService();
    }
    return AIUsageService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private getPeriodStart(period: 'day' | 'week' | 'month' | 'all'): string | null {
    switch (period) {
      case 'day':
        return `NOW() - INTERVAL '1 day'`;
      case 'week':
        return `NOW() - INTERVAL '7 days'`;
      case 'month':
        return `NOW() - INTERVAL '30 days'`;
      case 'all':
        return null;
    }
  }

  /**
   * Look up the effective quota config for a user.
   * Returns per-user config if it exists, otherwise the global default.
   */
  async getEffectiveQuotaConfig(userId: string): Promise<QuotaConfigRow | null> {
    const pool = this.getPool();
    const result = await pool.query(
      `SELECT * FROM ai.quota_config WHERE user_id = $1
       UNION ALL
       SELECT * FROM ai.quota_config WHERE user_id IS NULL
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] as QuotaConfigRow | undefined ?? null;
  }

  /**
   * Check whether a user is allowed to make an AI request with the given model.
   * Throws AppError if the user is over quota or the model is not allowed.
   */
  async checkQuota(userId: string, model: string): Promise<void> {
    const pool = this.getPool();
    const config = await this.getEffectiveQuotaConfig(userId);

    if (config) {
      if (config.model_allowlist && config.model_allowlist.length > 0) {
        if (!config.model_allowlist.includes(model)) {
          throw new AppError(
            `Model "${model}" is not in the allowed list for this user`,
            403,
            ERROR_CODES.AI_MODEL_NOT_ALLOWED
          );
        }
      }

      if (config.max_requests_per_day !== null) {
        const dayResult = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM ai.usage_log
           WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
          [userId]
        );
        if ((dayResult.rows[0] as { cnt: number }).cnt >= config.max_requests_per_day) {
          throw new AppError(
            `Daily request limit (${config.max_requests_per_day}) exceeded`,
            429,
            ERROR_CODES.AI_QUOTA_EXCEEDED
          );
        }
      }

      if (config.max_tokens_per_day !== null) {
        const dayTokens = await pool.query(
          `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total
           FROM ai.usage_log
           WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
          [userId]
        );
        if ((dayTokens.rows[0] as { total: number }).total >= config.max_tokens_per_day) {
          throw new AppError(
            `Daily token limit (${config.max_tokens_per_day}) exceeded`,
            429,
            ERROR_CODES.AI_QUOTA_EXCEEDED
          );
        }
      }

      if (config.max_tokens_per_month !== null) {
        const monthTokens = await pool.query(
          `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total
           FROM ai.usage_log
           WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
          [userId]
        );
        if ((monthTokens.rows[0] as { total: number }).total >= config.max_tokens_per_month) {
          throw new AppError(
            `Monthly token limit (${config.max_tokens_per_month}) exceeded`,
            429,
            ERROR_CODES.AI_QUOTA_EXCEEDED
          );
        }
      }

      if (config.monthly_spend_cap_usd !== null) {
        const monthCost = await pool.query(
          `SELECT COALESCE(SUM(estimated_cost), 0)::numeric(12,8) AS total
           FROM ai.usage_log
           WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'`,
          [userId]
        );
        const totalCost = parseFloat((monthCost.rows[0] as { total: string }).total);
        if (totalCost >= config.monthly_spend_cap_usd) {
          throw new AppError(
            `Monthly spend cap ($${config.monthly_spend_cap_usd}) exceeded`,
            429,
            ERROR_CODES.AI_QUOTA_EXCEEDED
          );
        }
      }
    }
  }

  /**
   * Log a completed AI request to the usage_log table.
   */
  async logUsage(
    userId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    endpoint: AIEndpoint,
    estimatedCost?: number
  ): Promise<void> {
    const pool = this.getPool();
    try {
      const cost = estimatedCost ?? 0;
      await pool.query(
        `INSERT INTO ai.usage_log (user_id, model, prompt_tokens, completion_tokens, estimated_cost, endpoint)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, model, promptTokens, completionTokens, cost, endpoint]
      );
    } catch (error) {
      logger.warn('Failed to log AI usage', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        model,
      });
    }
  }

  /**
   * Get aggregated usage for a user over a time period.
   */
  async getUserUsage(
    userId: string,
    period: 'day' | 'week' | 'month' | 'all' = 'month'
  ): Promise<UsageAggregate> {
    const pool = this.getPool();
    const periodStart = this.getPeriodStart(period);

    const query = periodStart
      ? `SELECT
           COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total_tokens,
           COALESCE(SUM(estimated_cost), 0)::numeric(12,8) AS estimated_cost,
           COUNT(*)::int AS request_count
         FROM ai.usage_log
         WHERE user_id = $1 AND created_at > ${periodStart}`
      : `SELECT
           COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total_tokens,
           COALESCE(SUM(estimated_cost), 0)::numeric(12,8) AS estimated_cost,
           COUNT(*)::int AS request_count
         FROM ai.usage_log
         WHERE user_id = $1`;

    const result = await pool.query(query, [userId]);
    return result.rows[0] as UsageAggregate;
  }

  /**
   * Get aggregated usage grouped by user and model for admin reports.
   */
  async getUsageReport(
    period: 'day' | 'week' | 'month' | 'all' = 'month',
    userId?: string,
    model?: string,
    limit = 50,
    offset = 0
  ): Promise<{
    entries: UsageByUserAndModel[];
    totals: UsageAggregate;
    period: string;
  }> {
    const pool = this.getPool();
    const periodStart = this.getPeriodStart(period);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (periodStart) {
      conditions.push(`created_at > ${periodStart}`);
    }
    if (userId) {
      conditions.push(`user_id = $${paramIdx++}`);
      params.push(userId);
    }
    if (model) {
      conditions.push(`model = $${paramIdx++}`);
      params.push(model);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const entriesResult = await pool.query(
        `SELECT
           user_id,
           model,
           SUM(prompt_tokens)::int AS prompt_tokens,
           SUM(completion_tokens)::int AS completion_tokens,
           SUM(prompt_tokens + completion_tokens)::int AS total_tokens,
           SUM(estimated_cost)::numeric(12,8) AS estimated_cost,
           COUNT(*)::int AS request_count
         FROM ai.usage_log
         ${whereClause}
         GROUP BY user_id, model
         ORDER BY total_tokens DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
      );

      const totalsResult = await pool.query(
        `SELECT
           COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
           COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
           COALESCE(SUM(prompt_tokens + completion_tokens), 0)::int AS total_tokens,
           COALESCE(SUM(estimated_cost), 0)::numeric(12,8) AS estimated_cost,
           COUNT(*)::int AS request_count
         FROM ai.usage_log
         ${whereClause}`,
        params.slice(0, params.length - 2)
      );

      return {
        entries: entriesResult.rows as UsageByUserAndModel[],
        totals: totalsResult.rows[0] as UsageAggregate,
        period,
      };
    } catch (error) {
      throw new AppError(
        `Failed to generate usage report: ${error instanceof Error ? error.message : String(error)}`,
        500,
        ERROR_CODES.AI_USAGE_REPORT_ERROR
      );
    }
  }

  /**
   * Get quota config for a specific user. Admin-only.
   */
  async getQuotaConfig(userId?: string): Promise<QuotaConfigRow[]> {
    const pool = this.getPool();
    if (userId) {
      const result = await pool.query(
        `SELECT * FROM ai.quota_config WHERE user_id = $1 ORDER BY user_id NULLS LAST`,
        [userId]
      );
      return result.rows as QuotaConfigRow[];
    }
    const result = await pool.query(
      `SELECT * FROM ai.quota_config ORDER BY user_id NULLS LAST`
    );
    return result.rows as QuotaConfigRow[];
  }

  /**
   * Create or update a quota config for a user.
   * If userId is null, updates the global default row.
   */
  async upsertQuotaConfig(
    userId: string | null,
    config: {
      maxRequestsPerDay?: number | null;
      maxTokensPerDay?: number | null;
      maxTokensPerMonth?: number | null;
      monthlySpendCapUsd?: number | null;
      modelAllowlist?: string[] | null;
    }
  ): Promise<QuotaConfigRow> {
    const pool = this.getPool();
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (config.maxRequestsPerDay !== undefined) {
      setClauses.push(`max_requests_per_day = $${paramIdx++}`);
      params.push(config.maxRequestsPerDay);
    }
    if (config.maxTokensPerDay !== undefined) {
      setClauses.push(`max_tokens_per_day = $${paramIdx++}`);
      params.push(config.maxTokensPerDay);
    }
    if (config.maxTokensPerMonth !== undefined) {
      setClauses.push(`max_tokens_per_month = $${paramIdx++}`);
      params.push(config.maxTokensPerMonth);
    }
    if (config.monthlySpendCapUsd !== undefined) {
      setClauses.push(`monthly_spend_cap_usd = $${paramIdx++}`);
      params.push(config.monthlySpendCapUsd);
    }
    if (config.modelAllowlist !== undefined) {
      setClauses.push(`model_allowlist = $${paramIdx++}`);
      params.push(config.modelAllowlist);
    }

    if (setClauses.length === 0) {
      const existing = await this.getQuotaConfig(userId ?? undefined);
      if (existing.length > 0) return existing[0];
      throw new AppError('No quota config found and no fields to update', 404, ERROR_CODES.NOT_FOUND);
    }

    setClauses.push(`updated_at = NOW()`);

    const result = await pool.query(
      `INSERT INTO ai.quota_config (user_id, ${setClauses.map((s) => s.split(' = ')[0]).join(', ')})
       VALUES ($1, ${params.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${setClauses.join(', ')}
       RETURNING *`,
      [userId, ...params]
    );

    return result.rows[0] as QuotaConfigRow;
  }
}
