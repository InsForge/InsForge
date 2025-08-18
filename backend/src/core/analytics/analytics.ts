import { Pool } from 'pg';
import { LogSource, AnalyticsLogRecord, LogSourceStats } from '@/types/logs.js';
import logger from '@/utils/logger.js';
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  StartQueryCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { isCloudEnvironment } from '@/utils/environment.js';

export class AnalyticsManager {
  private static instance: AnalyticsManager;
  private pool!: Pool;
  private provider: 'logflare' | 'cloudwatch' = 'logflare';
  private cwClient: CloudWatchLogsClient | null = null;
  private cwLogGroup: string | null = null;
  private cwRegion: string | null = null;

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
    // Decide provider based on environment and explicit override
    const explicitProvider = (process.env.ANALYTICS_PROVIDER || '').toLowerCase();
    const shouldUseCloudwatch =
      explicitProvider === 'cloudwatch' ||
      (!explicitProvider && isCloudEnvironment() && !!process.env.CLOUDWATCH_LOG_GROUP);

    if (shouldUseCloudwatch) {
      this.provider = 'cloudwatch';
      this.cwRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
      this.cwLogGroup = process.env.CLOUDWATCH_LOG_GROUP || null;

      if (!this.cwLogGroup) {
        throw new Error('CLOUDWATCH_LOG_GROUP is required when ANALYTICS_PROVIDER=cloudwatch');
      }

      this.cwClient = new CloudWatchLogsClient({ region: this.cwRegion });
      logger.info('Analytics provider initialized: CloudWatch Logs', {
        region: this.cwRegion,
        logGroup: this.cwLogGroup,
      });
      return;
    }

    // Default to Logflare/Postgres (explicit logflare or local dev)
    this.provider = 'logflare';
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
    if (this.provider === 'cloudwatch') {
      // Derive sources by inspecting stream suffixes
      const logGroup = this.cwLogGroup!;
      const client = this.cwClient!;

      // Default suffix mapping
      const suffixMapping: Record<string, string> = {
        'insforge.logs': process.env.CW_SUFFIX_INFORGE || 'insforge-vector',
        'postgREST.logs': process.env.CW_SUFFIX_POSTGREST || 'postgrest-vector',
        'postgres.logs': process.env.CW_SUFFIX_POSTGRES || 'postgres-vector',
        // 'function.logs': process.env.CW_SUFFIX_FUNCTION || 'function-vector', // optional
      };

      const cmd = new DescribeLogStreamsCommand({ logGroupName: logGroup });
      const result = await client.send(cmd);
      const streams = result.logStreams || [];

      const available: LogSource[] = [];
      let idCounter = 1;
      for (const [displayName, suffix] of Object.entries(suffixMapping)) {
        const have = streams.some((s) => (s.logStreamName || '').endsWith(`-${suffix}`) || (s.logStreamName || '').includes(suffix));
        if (have) {
          available.push({ id: idCounter++, name: displayName, token: suffix });
        }
      }
      return available;
    }

    // Logflare/Postgres path
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, name, token 
        FROM _analytics.sources 
        ORDER BY name
      `);

      const sourcesWithData: LogSource[] = [];
      for (const source of result.rows) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;
        try {
          const countResult = await client.query(`
            SELECT COUNT(*) as count
            FROM _analytics.${tableName}
          `);
          const count = parseInt(countResult.rows[0].count);
          if (count > 0) {
            sourcesWithData.push({
              ...source,
              name: this.getDisplayName(source.name),
            });
          }
        } catch (error) {
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
    if (this.provider === 'cloudwatch') {
      const client = this.cwClient!;
      const logGroup = this.cwLogGroup!;

      // Map source to stream suffix
      const suffixMapping: Record<string, string> = {
        'insforge.logs': process.env.CW_SUFFIX_INFORGE || 'insforge-vector',
        'postgREST.logs': process.env.CW_SUFFIX_POSTGREST || 'postgrest-vector',
        'postgres.logs': process.env.CW_SUFFIX_POSTGRES || 'postgres-vector',
        'function.logs': process.env.CW_SUFFIX_FUNCTION || 'function-vector',
      };
      const suffix = suffixMapping[sourceName] || suffixMapping[this.getDisplayName(sourceName)] || '';

      // Collect all streams matching suffix
      const dls = await client.send(new DescribeLogStreamsCommand({ logGroupName: logGroup }));
      const streams = (dls.logStreams || [])
        .map((s) => s.logStreamName || '')
        .filter((name) => (suffix ? name.endsWith(`-${suffix}`) || name.includes(suffix) : true));

      const startMs = startTime ? Date.parse(startTime) : undefined;
      const endMs = (beforeTimestamp ? Date.parse(beforeTimestamp) : undefined) || (endTime ? Date.parse(endTime) : undefined);

      const fle = await client.send(
        new FilterLogEventsCommand({
          logGroupName: logGroup,
          logStreamNames: streams.length > 0 ? streams.slice(0, 100) : undefined,
          startTime: startMs,
          endTime: endMs,
          limit,
        })
      );

      const events = fle.events || [];
      const logs: AnalyticsLogRecord[] = events.map((e) => {
        const message = e.message || '';
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(message);
        } catch {
          parsed = { message };
        }
        return {
          id: e.eventId || `${e.logStreamName || ''}-${e.timestamp || ''}`,
          timestamp: new Date((e.timestamp || Date.now())).toISOString(),
          event_message: typeof parsed === 'object' && parsed && (parsed as any).msg ? (parsed as any).msg : (typeof message === 'string' ? message.slice(0, 500) : String(message)),
          body: parsed as Record<string, any>,
        };
      });

      return {
        logs,
        total: logs.length,
        tableName: `cloudwatch:${logGroup}`,
      };
    }

    // Logflare/Postgres path
    const client = await this.pool.connect();
    try {
      const internalSourceName = this.getInternalName(sourceName);
      const sourceResult = await client.query(
        `SELECT token FROM _analytics.sources WHERE name = $1`,
        [internalSourceName]
      );
      if (sourceResult.rows.length === 0) {
        throw new Error(`Log source '${sourceName}' not found`);
      }
      const token = sourceResult.rows[0].token;
      const tableName = `log_events_${token.replace(/-/g, '_')}`;

      let query = `
        SELECT id, event_message, timestamp, body
        FROM _analytics.${tableName}
        WHERE 1=1
      `;
      const params: (string | number)[] = [];
      let paramIndex = 1;
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
      if (beforeTimestamp) {
        query += ` AND timestamp < $${paramIndex}`;
        params.push(beforeTimestamp);
        paramIndex++;
      }
      query += ` ORDER BY timestamp DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const logsResult = await client.query(query, params);

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
    if (this.provider === 'cloudwatch') {
      const client = this.cwClient!;
      const logGroup = this.cwLogGroup!;
      const sources = await this.getLogSources();
      const stats: LogSourceStats[] = [];

      for (const src of sources) {
        // Use DescribeLogStreams to get last ingestion time as proxy for last activity
        const dls = await client.send(new DescribeLogStreamsCommand({ logGroupName: logGroup }));
        const suffix = src.token;
        const last = (dls.logStreams || [])
          .filter((s) => (s.logStreamName || '').includes(suffix))
          .reduce<number | null>((acc, s) => {
            const t = s.lastIngestionTime ?? s.creationTime ?? null;
            if (t == null) return acc;
            if (acc == null) return t;
            return Math.max(acc, t);
          }, null);

        stats.push({
          source: src.name,
          count: 0, // Optional: can be computed via Logs Insights if needed
          lastActivity: last ? new Date(last).toISOString() : '',
        });
      }

      return stats;
    }

    // Logflare/Postgres path
    const client = await this.pool.connect();
    try {
      const sources = await this.getLogSources();
      const stats: LogSourceStats[] = [];
      for (const source of sources) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;
        try {
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
    if (this.provider === 'cloudwatch') {
      const client = this.cwClient!;
      const logGroup = this.cwLogGroup!;

      // Choose time range (default last 7 days)
      const end = Date.now();
      const start = end - 7 * 24 * 60 * 60 * 1000;

      // Build query string
      const escaped = query.replace(/"/g, '\\"');
      let insights = `fields @timestamp, @message, @logStream | filter @message like /${escaped}/`;
      if (sourceName) {
        const suffix = sourceName === 'insforge.logs'
          ? (process.env.CW_SUFFIX_INFORGE || 'insforge-vector')
          : sourceName === 'postgREST.logs'
          ? (process.env.CW_SUFFIX_POSTGREST || 'postgrest-vector')
          : sourceName === 'postgres.logs'
          ? (process.env.CW_SUFFIX_POSTGRES || 'postgres-vector')
          : (process.env.CW_SUFFIX_FUNCTION || 'function-vector');
        insights += ` | filter @logStream like /${suffix}/`;
      }
      insights += ` | sort @timestamp desc | limit ${limit}`;

      const startQuery = await client.send(new StartQueryCommand({
        logGroupName: logGroup,
        startTime: Math.floor(start / 1000),
        endTime: Math.floor(end / 1000),
        queryString: insights,
        limit,
      }));
      const qid = startQuery.queryId!;

      // Poll results briefly (simple loop, small wait)
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let results;
      for (let i = 0; i < 20; i++) {
        const r = await client.send(new GetQueryResultsCommand({ queryId: qid }));
        if (r.status === 'Complete' || r.status === 'Failed' || r.status === 'Cancelled') {
          results = r.results || [];
          break;
        }
        await sleep(300);
      }
      const rows = results || [];
      const toObj = (row: any[]) => Object.fromEntries(row.map((c: any) => [c.field, c.value]));
      const mapped: (AnalyticsLogRecord & { source: string })[] = rows.map((r: any) => {
        const o = toObj(r);
        const msg = o['@message'] || '';
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(msg); } catch { parsed = { message: msg }; }
        const logStream: string = o['@logStream'] || '';
        const source: string = logStream.includes('postgrest')
          ? 'postgREST.logs'
          : logStream.includes('postgres')
          ? 'postgres.logs'
          : 'insforge.logs';
        return {
          id: `${o['@logStream']}-${o['@timestamp']}`,
          timestamp: new Date(Number(o['@timestamp'] || Date.now())).toISOString(),
          event_message: typeof parsed === 'object' && (parsed as any).msg ? (parsed as any).msg : (typeof msg === 'string' ? msg.slice(0, 500) : String(msg)),
          body: parsed as Record<string, any>,
          source,
        };
      });

      return { logs: mapped, total: mapped.length };
    }

    // Logflare/Postgres path
    const client = await this.pool.connect();
    try {
      let sources: LogSource[];
      if (sourceName) {
        const internalSourceName = this.getInternalName(sourceName);
        const sourceResult = await client.query(
          `SELECT id, name, token FROM _analytics.sources WHERE name = $1`,
          [internalSourceName]
        );
        sources = sourceResult.rows.map((source) => ({
          ...source,
          name: this.getDisplayName(source.name),
        }));
      } else {
        sources = await this.getLogSources();
      }

      const results: (AnalyticsLogRecord & { source: string })[] = [];
      let totalCount = 0;
      for (const source of sources) {
        const tableName = `log_events_${source.token.replace(/-/g, '_')}`;
        try {
          const searchResult = await client.query(
            `SELECT id, event_message, timestamp, body, $1 as source
            FROM _analytics.${tableName}
            WHERE event_message ILIKE $2 
               OR body::text ILIKE $2
            ORDER BY timestamp DESC
            LIMIT $3 OFFSET $4`,
            [source.name, `%${query}%`, limit, offset]
          );
          results.push(...(searchResult.rows as (AnalyticsLogRecord & { source: string })[]));
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
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { logs: results.slice(0, limit), total: totalCount };
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.provider === 'logflare' && this.pool) {
      await this.pool.end();
    }
  }
}
