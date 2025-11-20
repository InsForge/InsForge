import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';

interface McpUsageRecord {
  tool_name: string;
  success: boolean;
  created_at: string;
}

interface UsageStats {
  mcp_usage_count: number;
  database_size_bytes: number;
  storage_size_bytes: number;
}

/**
 * UsageService - Handles usage tracking and statistics
 * Business logic layer for MCP usage and system resource tracking
 */
export class UsageService {
  private static instance: UsageService;
  private pool: Pool | null = null;

  private constructor() {}

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
   * Create MCP tool usage record
   */
  async createMcpUsage(toolName: string, success: boolean = true): Promise<{ created_at: string }> {
    try {
      const result = await this.getPool().query(
        `
          INSERT INTO _mcp_usage (tool_name, success)
          VALUES ($1, $2)
          RETURNING created_at
        `,
        [toolName, success]
      );

      return {
        created_at: result.rows[0].created_at,
      };
    } catch (error) {
      logger.error('Error creating MCP usage record', {
        error: error instanceof Error ? error.message : String(error),
        toolName,
        success,
      });
      throw error;
    }
  }

  /**
   * Get MCP usage records
   */
  async getMcpUsage(limit: number = 5, success: boolean = true): Promise<McpUsageRecord[]> {
    try {
      const result = await this.getPool().query(
        `
          SELECT tool_name, success, created_at
          FROM _mcp_usage
          WHERE success = $1
          ORDER BY created_at DESC
          LIMIT $2
        `,
        [success, limit]
      );

      return result.rows as McpUsageRecord[];
    } catch (error) {
      logger.error('Error getting MCP usage records', {
        error: error instanceof Error ? error.message : String(error),
        limit,
        success,
      });
      throw error;
    }
  }

  /**
   * Get usage statistics for a date range
   * Returns MCP usage count, database size, and storage size
   */
  async getUsageStats(startDate: Date, endDate: Date): Promise<UsageStats> {
    try {
      // Get MCP tool usage count within date range
      const mcpResult = await this.getPool().query(
        `
          SELECT COUNT(*) as count
          FROM _mcp_usage
          WHERE success = true
            AND created_at >= $1
            AND created_at < $2
        `,
        [startDate, endDate]
      );
      const mcpUsageCount = parseInt(mcpResult.rows[0]?.count || '0');

      // Get database size (in bytes)
      const dbSizeResult = await this.getPool().query(
        `
          SELECT pg_database_size(current_database()) as size
        `
      );
      const databaseSize = parseInt(dbSizeResult.rows[0]?.size || '0');

      // Get total storage size from _storage table
      const storageResult = await this.getPool().query(
        `
          SELECT COALESCE(SUM(size), 0) as total_size
          FROM _storage
        `
      );
      const storageSize = parseInt(storageResult.rows[0]?.total_size || '0');

      return {
        mcp_usage_count: mcpUsageCount,
        database_size_bytes: databaseSize,
        storage_size_bytes: storageSize,
      };
    } catch (error) {
      logger.error('Error getting usage statistics', {
        error: error instanceof Error ? error.message : String(error),
        startDate,
        endDate,
      });
      throw error;
    }
  }
}
