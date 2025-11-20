import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';

export interface AIUsageByModel {
  model: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_images: number;
}

export interface UsageStats {
  mcp_usage_count: number;
  database_size_bytes: number;
  storage_size_bytes: number;
  ai_usage_by_model: AIUsageByModel[];
}

export interface MCPUsageRecord {
  tool_name: string;
  success: boolean;
  created_at: string;
}

/**
 * UsageService - Handles usage tracking and statistics
 * Business logic layer for MCP usage, system resource tracking, and AI usage
 */
export class UsageService {
  private static instance: UsageService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('UsageService initialized');
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  public static getInstance(): UsageService {
    if (!UsageService.instance) {
      UsageService.instance = new UsageService();
    }
    return UsageService.instance;
  }

  /**
   * Record MCP tool usage
   */
  async recordMCPUsage(toolName: string, success: boolean = true): Promise<{ created_at: string }> {
    try {
      const result = await this.getPool().query(
        `INSERT INTO _mcp_usage (tool_name, success)
         VALUES ($1, $2)
         RETURNING created_at`,
        [toolName, success]
      );

      logger.info('MCP usage recorded', { toolName, success });
      return { created_at: result.rows[0].created_at };
    } catch (error) {
      logger.error('Failed to record MCP usage', { error, toolName });
      throw new Error('Failed to record MCP usage');
    }
  }

  /**
   * Get recent MCP usage records
   */
  async getMCPUsage(limit: number = 5, success: boolean = true): Promise<MCPUsageRecord[]> {
    try {
      const result = await this.getPool().query(
        `SELECT tool_name, success, created_at
         FROM _mcp_usage
         WHERE success = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [success, limit]
      );

      return result.rows as MCPUsageRecord[];
    } catch (error) {
      logger.error('Failed to get MCP usage', { error });
      throw new Error('Failed to get MCP usage');
    }
  }

  /**
   * Get comprehensive usage statistics for a date range
   * Returns MCP usage, database size, storage size, and AI usage by model
   */
  async getUsageStats(startDate: Date, endDate: Date): Promise<UsageStats> {
    try {
      // Get MCP tool usage count
      const mcpResult = await this.getPool().query(
        `SELECT COUNT(*) as count
         FROM _mcp_usage
         WHERE success = true
           AND created_at >= $1
           AND created_at < $2`,
        [startDate, endDate]
      );

      // Get database size
      const dbSizeResult = await this.getPool().query(
        `SELECT pg_database_size(current_database()) as size`
      );

      // Get total storage size
      const storageResult = await this.getPool().query(
        `SELECT COALESCE(SUM(size), 0) as total_size FROM _storage`
      );

      // Get AI usage breakdown by model (only billable metrics)
      const aiUsageByModel = await this.getPool().query(
        `SELECT
          COALESCE(u.model_id, c.model_id) as model,
          COALESCE(SUM(u.input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(u.output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(u.image_count), 0) as total_images
        FROM _ai_usage u
        LEFT JOIN _ai_configs c ON u.config_id = c.id
        WHERE u.created_at >= $1 AND u.created_at < $2
        GROUP BY COALESCE(u.model_id, c.model_id)
        ORDER BY (COALESCE(SUM(u.input_tokens), 0) + COALESCE(SUM(u.output_tokens), 0)) DESC`,
        [startDate, endDate]
      );

      return {
        mcp_usage_count: parseInt(mcpResult.rows[0]?.count || '0'),
        database_size_bytes: parseInt(dbSizeResult.rows[0]?.size || '0'),
        storage_size_bytes: parseInt(storageResult.rows[0]?.total_size || '0'),
        ai_usage_by_model: aiUsageByModel.rows.map((row) => ({
          model: (row.model as string) || 'unknown',
          total_input_tokens: parseInt(String(row.total_input_tokens || '0')),
          total_output_tokens: parseInt(String(row.total_output_tokens || '0')),
          total_images: parseInt(String(row.total_images || '0')),
        })),
      };
    } catch (error) {
      logger.error('Failed to get usage stats', { error });
      throw new Error('Failed to get usage stats');
    }
  }
}
