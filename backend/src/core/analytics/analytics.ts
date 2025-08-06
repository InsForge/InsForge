import { Pool } from 'pg';
import { LogSource, AnalyticsLogRecord, LogSourceStats } from '@/types/logs.js';
import logger from '@/utils/logger.js';

export class AnalyticsManager {
  private static instance: AnalyticsManager;
  private pool!: Pool;

  // Source name mapping for user-friendly display
  private sourceNameMap: Record<string, string> = {
    'cloudflare.logs.prod': 'insforge.logs',
    'deno-relay-logs': 'function.logs',
    'postgREST.logs.prod': 'postgREST.logs',
    'postgres.logs': 'postgres.logs',
  };

  // Reverse mapping for API calls
  private reverseSourceNameMap: Record<string, string> = {
    'insforge.logs': 'cloudflare.logs.prod',
    'function.logs': 'deno-relay-logs',
    'postgREST.logs': 'postgREST.logs.prod',
    'postgres.logs': 'postgres.logs',
  };

  private constructor() {}

  static getInstance(): AnalyticsManager {
    if (!AnalyticsManager.instance) {
      AnalyticsManager.instance = new AnalyticsManager();
    }
    return AnalyticsManager.instance;
  }

  // Convert internal source name to display name
  private getDisplayName(sourceName: string): string {
    return this.sourceNameMap[sourceName] || sourceName;
  }

  // Convert display name back to internal source name
  private getInternalName(displayName: string): string {
    return this.reverseSourceNameMap[displayName] || displayName;
  }

  async initialize(): Promise<void> {
    // PostgreSQL connection configuration for _insforge database
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: '_insforge', // Analytics database
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    try {
      // Test connection
      const client = await this.pool.connect();
      client.release();
      logger.info('Analytics database connection established');
    } catch (error) {
      logger.error('Failed to connect to analytics database', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // Get all available log sources (only those with data)
  async getLogSources(): Promise<LogSource[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, name, token 
        FROM _analytics.sources 
        ORDER BY name
      `);

      // Filter out sources that have no data
      const sourcesWithData: LogSource[] = [];

      for (const source of result.rows) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;

        try {
          // Check if the table exists and has data
          const countResult = await client.query(`
            SELECT COUNT(*) as count
            FROM _analytics.${tableName}
          `);

          const count = parseInt(countResult.rows[0].count);
          if (count > 0) {
            // Apply name mapping before returning
            sourcesWithData.push({
              ...source,
              name: this.getDisplayName(source.name),
            });
          }
        } catch (error) {
          // If table doesn't exist or query fails, skip this source
          logger.warn(`Source ${source.name} has no accessible data`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return sourcesWithData;
    } finally {
      client.release();
    }
  }

  // Get logs from a specific source using timestamp-based pagination
  async getLogsBySource(
    sourceName: string,
    limit: number = 100,
    beforeTimestamp?: string,
    startTime?: string,
    endTime?: string
  ): Promise<{
    logs: AnalyticsLogRecord[];
    total: number;
    tableName: string;
  }> {
    const client = await this.pool.connect();
    try {
      // Convert display name to internal name for query
      const internalSourceName = this.getInternalName(sourceName);

      // First, get the source token to determine the table name
      const sourceResult = await client.query(
        `SELECT token FROM _analytics.sources WHERE name = $1`,
        [internalSourceName]
      );

      if (sourceResult.rows.length === 0) {
        throw new Error(`Log source '${sourceName}' not found`);
      }

      const token = sourceResult.rows[0].token;
      const tableName = `log_events_${token.replace(/-/g, '_')}`;

      // Build the query with timestamp-based pagination
      let query = `
        SELECT id, event_message, timestamp, body
        FROM _analytics.${tableName}
        WHERE 1=1
      `;
      const params: (string | number)[] = [];
      let paramIndex = 1;

      // Add time range filters
      if (startTime) {
        query += ` AND timestamp >= $${paramIndex}`;
        params.push(startTime);
        paramIndex++;
      }

      if (endTime) {
        query += ` AND timestamp <= $${paramIndex}`;
        params.push(endTime);
        paramIndex++;
      }

      // Add timestamp cursor for pagination (load older logs)
      if (beforeTimestamp) {
        query += ` AND timestamp < $${paramIndex}`;
        params.push(beforeTimestamp);
        paramIndex++;
      }

      // Always order by timestamp DESC to get newest first, then reverse in frontend
      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const logsResult = await client.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) as count FROM _analytics.${tableName} WHERE 1=1`;
      const countParams: string[] = [];
      let countParamIndex = 1;

      if (startTime) {
        countQuery += ` AND timestamp >= $${countParamIndex}`;
        countParams.push(startTime);
        countParamIndex++;
      }

      if (endTime) {
        countQuery += ` AND timestamp <= $${countParamIndex}`;
        countParams.push(endTime);
        countParamIndex++;
      }

      const countResult = await client.query(countQuery, countParams);

      return {
        logs: logsResult.rows,
        total: parseInt(countResult.rows[0].count),
        tableName: `_analytics.${tableName}`,
      };
    } finally {
      client.release();
    }
  }

  // Get statistics for all log sources
  async getLogSourceStats(): Promise<LogSourceStats[]> {
    const client = await this.pool.connect();
    try {
      const sources = await this.getLogSources();
      const stats: LogSourceStats[] = [];

      for (const source of sources) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;

        try {
          // Get count and last activity for each source
          const result = await client.query(`
            SELECT 
              COUNT(*) as count,
              MAX(timestamp) as last_activity
            FROM _analytics.${tableName}
          `);

          stats.push({
            source: source.name,
            count: parseInt(result.rows[0].count),
            lastActivity: result.rows[0].last_activity || '',
          });
        } catch (error) {
          // If table doesn't exist or query fails, add with zero count
          logger.warn(`Failed to get stats for source ${source.name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          stats.push({
            source: source.name,
            count: 0,
            lastActivity: '',
          });
        }
      }

      return stats.sort((a, b) => b.count - a.count);
    } finally {
      client.release();
    }
  }

  // Search logs across all sources or specific source
  async searchLogs(
    query: string,
    sourceName?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    logs: (AnalyticsLogRecord & { source: string })[];
    total: number;
  }> {
    const client = await this.pool.connect();
    try {
      let sources: LogSource[];

      if (sourceName) {
        // Convert display name to internal name for query
        const internalSourceName = this.getInternalName(sourceName);
        const sourceResult = await client.query(
          `SELECT id, name, token FROM _analytics.sources WHERE name = $1`,
          [internalSourceName]
        );
        // Apply name mapping to the result
        sources = sourceResult.rows.map((source) => ({
          ...source,
          name: this.getDisplayName(source.name),
        }));
      } else {
        // getLogSources already returns mapped names
        sources = await this.getLogSources();
      }

      const results: (AnalyticsLogRecord & { source: string })[] = [];
      let totalCount = 0;

      for (const source of sources) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;

        try {
          // Search in event_message and body fields
          const searchResult = await client.query(
            `SELECT id, event_message, timestamp, body, $1 as source
            FROM _analytics.${tableName}
            WHERE event_message ILIKE $2 
               OR body::text ILIKE $2
            ORDER BY timestamp DESC
            LIMIT $3 OFFSET $4`,
            [source.name, `%${query}%`, limit, offset]
          );

          results.push(...searchResult.rows);

          // Get count for this source
          const countResult = await client.query(
            `SELECT COUNT(*) as count
            FROM _analytics.${tableName}
            WHERE event_message ILIKE $1 
               OR body::text ILIKE $1`,
            [`%${query}%`]
          );

          totalCount += parseInt(countResult.rows[0].count);
        } catch (error) {
          logger.warn(`Failed to search in source ${source.name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Sort combined results by timestamp
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return {
        logs: results.slice(0, limit),
        total: totalCount,
      };
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
