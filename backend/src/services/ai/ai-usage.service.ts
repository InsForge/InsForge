import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';

export interface AIUsageLogEntry {
  userId: string;
  userRole: string;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  status: 'success' | 'error';
}

export interface AIUsageStats {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  requestsToday: number;
  tokensToday: number;
  costToday: number;
  tokensThisMonth: number;
  costThisMonth: number;
}

export interface AIUsageReportEntry {
  userId: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  lastRequestAt: string;
}

/**
 * AIUsageService — records and queries per-user AI gateway usage.
 */
export class AIUsageService {
  private static instance: AIUsageService;
  private pool: Pool;

  private constructor() {
    this.pool = DatabaseManager.getInstance().getPool();
  }

  public static getInstance(): AIUsageService {
    if (!AIUsageService.instance) {
      AIUsageService.instance = new AIUsageService();
    }
    return AIUsageService.instance;
  }

  /**
   * Record a single AI gateway request.
   */
  async recordUsage(entry: AIUsageLogEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ai.usage_log
          (user_id, user_role, model, endpoint, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.userId,
          entry.userRole,
          entry.model,
          entry.endpoint,
          entry.promptTokens,
          entry.completionTokens,
          entry.totalTokens,
          entry.estimatedCostUsd,
          entry.status,
        ]
      );
    } catch (error) {
      // Usage logging should never block the response — log and swallow.
      logger.error('Failed to record AI usage', {
        error: error instanceof Error ? error.message : String(error),
        userId: entry.userId,
        model: entry.model,
      });
    }
  }

  /**
   * Get usage stats for a specific user (used by quota enforcement).
   */
  async getUserStats(userId: string): Promise<AIUsageStats> {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);

    const result = await this.pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'success') AS total_requests,
        COALESCE(SUM(total_tokens) FILTER (WHERE status = 'success'), 0) AS total_tokens,
        COALESCE(SUM(estimated_cost_usd) FILTER (WHERE status = 'success'), 0) AS total_cost_usd,
        COUNT(*) FILTER (WHERE status = 'success' AND created_at >= $2) AS requests_today,
        COALESCE(SUM(total_tokens) FILTER (WHERE status = 'success' AND created_at >= $2), 0) AS tokens_today,
        COALESCE(SUM(estimated_cost_usd) FILTER (WHERE status = 'success' AND created_at >= $2), 0) AS cost_today,
        COALESCE(SUM(total_tokens) FILTER (WHERE status = 'success' AND created_at >= $3), 0) AS tokens_this_month,
        COALESCE(SUM(estimated_cost_usd) FILTER (WHERE status = 'success' AND created_at >= $3), 0) AS cost_this_month
      FROM ai.usage_log
      WHERE user_id = $1`,
      [userId, startOfDay.toISOString(), startOfMonth.toISOString()]
    );

    const row = result.rows[0];
    return {
      totalRequests: parseInt(row.total_requests || '0'),
      totalTokens: parseInt(row.total_tokens || '0'),
      totalCostUsd: parseFloat(row.total_cost_usd || '0'),
      requestsToday: parseInt(row.requests_today || '0'),
      tokensToday: parseInt(row.tokens_today || '0'),
      costToday: parseFloat(row.cost_today || '0'),
      tokensThisMonth: parseInt(row.tokens_this_month || '0'),
      costThisMonth: parseFloat(row.cost_this_month || '0'),
    };
  }

  /**
   * Get admin usage report — aggregated per user.
   */
  async getUsageReport(options: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: AIUsageReportEntry[]; total: number }> {
    const { startDate, endDate, limit = 50, offset = 0 } = options;

    let whereClause = "WHERE status = 'success'";
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereClause += ` AND created_at < $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(DISTINCT user_id) AS total FROM ai.usage_log ${whereClause}`,
      params
    );

    const dataResult = await this.pool.query(
      `SELECT
        user_id AS "userId",
        COUNT(*) AS "totalRequests",
        COALESCE(SUM(total_tokens), 0) AS "totalTokens",
        COALESCE(SUM(estimated_cost_usd), 0) AS "totalCostUsd",
        MAX(created_at) AS "lastRequestAt"
      FROM ai.usage_log
      ${whereClause}
      GROUP BY user_id
      ORDER BY SUM(estimated_cost_usd) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      data: dataResult.rows.map((row) => ({
        userId: row.userId,
        totalRequests: parseInt(row.totalRequests),
        totalTokens: parseInt(row.totalTokens),
        totalCostUsd: parseFloat(row.totalCostUsd),
        lastRequestAt: row.lastRequestAt,
      })),
      total: parseInt(countResult.rows[0]?.total || '0'),
    };
  }
}
