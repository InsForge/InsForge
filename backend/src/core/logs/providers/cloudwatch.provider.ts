import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
  StartQueryCommand,
  GetQueryResultsCommand,
  CreateLogGroupCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import logger from '@/utils/logger.js';
import { BaseLogProvider } from './base.provider.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { LogSchema, LogSourceSchema, LogStatsSchema } from '@insforge/shared-schemas';

export class CloudWatchProvider extends BaseLogProvider {
  private cwClient: CloudWatchLogsClient | null = null;
  private cwLogGroup: string | null = null;
  private cwRegion: string | null = null;

  async initialize(): Promise<void> {
    this.cwRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2';
    this.cwLogGroup = process.env.CLOUDWATCH_LOG_GROUP || '/insforge/local';

    const cloudwatchOpts: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = { region: this.cwRegion };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      cloudwatchOpts.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      };
    }

    this.cwClient = new CloudWatchLogsClient({ ...cloudwatchOpts });

    // Create log group if it doesn't exist
    try {
      await this.cwClient.send(new CreateLogGroupCommand({ logGroupName: this.cwLogGroup }));
      logger.info(`Created CloudWatch log group: ${this.cwLogGroup}`);
    } catch (error) {
      if (error instanceof ResourceAlreadyExistsException) {
        logger.info(`CloudWatch log group already exists: ${this.cwLogGroup}`);
      } else {
        logger.warn(`Could not create CloudWatch log group: ${error}`);
      }
    }
  }

  private getSuffixMapping(): Record<string, string> {
    return {
      'insforge.logs': process.env.CW_SUFFIX_INFORGE || 'insforge-vector',
      'postgREST.logs': process.env.CW_SUFFIX_POSTGREST || 'postgrest-vector',
      'postgres.logs': process.env.CW_SUFFIX_POSTGRES || 'postgres-vector',
      'function.logs': process.env.CW_SUFFIX_FUNCTION || 'function-vector',
    };
  }

  async getLogSources(): Promise<LogSourceSchema[]> {
    if (!this.cwLogGroup || !this.cwClient) {
      throw new AppError(
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY not found in environment variables',
        500,
        ERROR_CODES.LOGS_AWS_NOT_CONFIGURED
      );
    }
    const logGroup = this.cwLogGroup;
    const client = this.cwClient;
    const suffixMapping = this.getSuffixMapping();

    const cmd = new DescribeLogStreamsCommand({ logGroupName: logGroup });
    const result = await client.send(cmd);
    const streams = result.logStreams || [];

    const available: LogSourceSchema[] = [];
    let idCounter = 1;

    for (const [displayName, suffix] of Object.entries(suffixMapping)) {
      const have = streams.some((s) => (s.logStreamName || '').includes(suffix));
      if (have) {
        available.push({ id: String(idCounter++), name: displayName, token: suffix });
      }
    }

    return available;
  }

  async getLogsBySource(
    sourceName: string,
    limit: number = 100,
    beforeTimestamp?: string
  ): Promise<{
    logs: LogSchema[];
    total: number;
    tableName: string;
  }> {
    if (!this.cwLogGroup || !this.cwClient) {
      throw new AppError(
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY not found in environment variables',
        500,
        ERROR_CODES.LOGS_AWS_NOT_CONFIGURED
      );
    }
    const client = this.cwClient;
    const logGroup = this.cwLogGroup;
    const suffixMapping = this.getSuffixMapping();

    const suffix =
      suffixMapping[sourceName] || suffixMapping[this.getDisplayName(sourceName)] || '';

    const dls = await client.send(new DescribeLogStreamsCommand({ logGroupName: logGroup }));
    const streams = (dls.logStreams || [])
      .map((s) => s.logStreamName || '')
      .filter((name) => (suffix ? name.includes(suffix) : true));

    // Use beforeTimestamp as the end time, default to now
    const endMs = beforeTimestamp ? Date.parse(beforeTimestamp) : Date.now();
    // Look back 24 hours from the endMs for the time window
    const startMs = endMs - 24 * 60 * 60 * 1000;

    // For getLogsBySource, we need to handle two cases:
    // 1. No beforeTimestamp: get the most recent logs (need to fetch all to find the newest)
    // 2. With beforeTimestamp: get logs before that timestamp

    let events: Array<{
      eventId?: string;
      timestamp?: number;
      message?: string;
      logStreamName?: string;
    }>;

    if (!beforeTimestamp) {
      // Case 1: Get the most recent logs - use reliable approach instead of Insights
      // CloudWatch Insights can be inconsistent, so use FilterLogEvents with pagination
      const allEvents: Array<{
        eventId?: string;
        timestamp?: number;
        message?: string;
        logStreamName?: string;
      }> = [];
      let nextToken: string | undefined;

      do {
        const fle = await client.send(
          new FilterLogEventsCommand({
            logGroupName: logGroup,
            logStreamNames: streams.length ? streams.slice(0, 100) : undefined,
            startTime: startMs,
            endTime: endMs,
            nextToken,
          })
        );

        const pageEvents = fle.events || [];
        allEvents.push(...pageEvents);
        nextToken = fle.nextToken;

        // Safety break to avoid infinite loops
        if (allEvents.length > 50000) {
          break;
        }
      } while (nextToken);

      // Get the most recent 'limit' events (events are in chronological order)
      events = allEvents.slice(-limit);
    } else {
      // Case 2: Get logs before the specified timestamp (pagination)
      // Use CloudWatch Insights for efficient timestamp-based pagination
      try {
        const beforeMs = Date.parse(beforeTimestamp);
        // Use a reasonable time window - look back up to 7 days
        const maxLookbackMs = 7 * 24 * 60 * 60 * 1000;
        const startMs = beforeMs - maxLookbackMs;

        const insights = `fields @timestamp, @message, @logStream, @eventId
          | filter @logStream like /${suffix}/
          | filter @timestamp < ${beforeMs}
          | sort @timestamp desc
          | limit ${limit}`;

        const startQuery = await client.send(
          new StartQueryCommand({
            logGroupName: logGroup,
            startTime: Math.floor(startMs / 1000),
            endTime: Math.floor(beforeMs / 1000),
            queryString: insights,
            limit,
          })
        );

        const qid = startQuery.queryId || '';
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        let results;

        // Wait for query to complete
        for (let i = 0; i < 15; i++) {
          const r = await client.send(new GetQueryResultsCommand({ queryId: qid }));
          if (r.status === 'Complete' || r.status === 'Failed' || r.status === 'Cancelled') {
            results = r.results || [];
            break;
          }
          await sleep(300);
        }

        if (results && results.length) {
          // Convert Insights results to our format
          events = results.map((row) => {
            const obj = Object.fromEntries(row.map((c) => [c.field || '', c.value || '']));

            // Parse timestamp properly
            let timestamp: number;
            const timestampValue = obj['@timestamp'];
            timestamp = parseInt(timestampValue);
            if (isNaN(timestamp) || timestamp < 1000000000000) {
              timestamp = Date.parse(timestampValue);
            }

            return {
              eventId: obj['@eventId'] || `insights-${Date.now()}-${Math.random()}`,
              timestamp: timestamp,
              message: obj['@message'] || '',
              logStreamName: obj['@logStream'] || '',
            };
          });

          // Ensure proper sorting by timestamp (CloudWatch Insights sorting may not be reliable)
          // Sort in ascending order (oldest first) to match CloudWatch's standard behavior
          events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        } else {
          events = [];
        }
      } catch (error) {
        // Fallback to FilterLogEvents with optimized approach
        logger.warn('CloudWatch Insights failed for pagination, using FilterLogEvents fallback', {
          error: error instanceof Error ? error.message : String(error),
        });

        const beforeMs = Date.parse(beforeTimestamp);
        // Use a smaller time window for fallback - 6 hours instead of 24
        const fallbackStartMs = beforeMs - 6 * 60 * 60 * 1000;

        const fle = await client.send(
          new FilterLogEventsCommand({
            logGroupName: logGroup,
            logStreamNames: streams.length ? streams.slice(0, 100) : undefined,
            startTime: fallbackStartMs,
            endTime: beforeMs,
            limit: limit * 2, // Get a bit more to ensure we have enough
          })
        );

        const allEvents = fle.events || [];
        // Get the most recent 'limit' events
        events = allEvents.slice(-limit);
      }
    }
    // Keep CloudWatch's default order (oldest first, newest last)
    const logs: LogSchema[] = events.map((e) => {
      const message = e.message || '';
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(message);
      } catch {
        parsed = { message };
      }

      return {
        id: e.eventId || `${e.logStreamName || ''}-${e.timestamp || ''}`,
        // CloudWatch timestamp is in milliseconds
        timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
        eventMessage:
          typeof parsed === 'object' && parsed && (parsed as Record<string, unknown>).msg
            ? String((parsed as Record<string, unknown>).msg)
            : typeof message === 'string'
              ? message.slice(0, 500)
              : String(message),
        body: parsed as Record<string, unknown>,
      };
    });

    return {
      logs,
      total: logs.length,
      tableName: `cloudwatch:${logGroup}`,
    };
  }

  async getLogSourceStats(): Promise<LogStatsSchema[]> {
    if (!this.cwLogGroup || !this.cwClient) {
      throw new AppError(
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY not found in environment variables',
        500,
        ERROR_CODES.LOGS_AWS_NOT_CONFIGURED
      );
    }
    const client = this.cwClient;
    const logGroup = this.cwLogGroup;
    const sources = await this.getLogSources();
    const stats: LogStatsSchema[] = [];
    const suffixMapping = this.getSuffixMapping();

    const dls = await client.send(new DescribeLogStreamsCommand({ logGroupName: logGroup }));
    const streams = dls.logStreams || [];

    for (const src of sources) {
      const suffix = suffixMapping[src.name] || suffixMapping[this.getDisplayName(src.name)] || '';
      const sourceStreams = streams
        .map((s) => s.logStreamName || '')
        .filter((name) => (suffix ? name.includes(suffix) : true));

      let lastActivity = '';

      if (sourceStreams.length) {
        try {
          // Use EXACTLY the same approach as getLogsBySource to get consistent results
          const endMs = Date.now();
          const startMs = endMs - 24 * 60 * 60 * 1000; // Look back 24 hours (same as getLogsBySource)

          // Use CloudWatch Insights to efficiently get the latest timestamp
          try {
            const insights = `fields @timestamp | filter @logStream like /${suffix}/ | sort @timestamp desc | limit 1`;

            const startQuery = await client.send(
              new StartQueryCommand({
                logGroupName: logGroup,
                startTime: Math.floor(startMs / 1000),
                endTime: Math.floor(endMs / 1000),
                queryString: insights,
                limit: 1,
              })
            );

            const qid = startQuery.queryId || '';
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
            let results;

            // Wait for query to complete (shorter timeout for stats)
            for (let i = 0; i < 10; i++) {
              const r = await client.send(new GetQueryResultsCommand({ queryId: qid }));
              if (r.status === 'Complete' || r.status === 'Failed' || r.status === 'Cancelled') {
                results = r.results || [];
                break;
              }
              await sleep(200);
            }

            if (results && results.length) {
              const row = results[0];
              const timestampField = row.find((field) => field.field === '@timestamp');
              if (timestampField && timestampField.value) {
                // CloudWatch Insights returns timestamp as string, try different parsing methods
                let timestamp: number;
                const value = timestampField.value;

                // Try parsing as milliseconds first
                timestamp = parseInt(value);
                if (isNaN(timestamp) || timestamp < 1000000000000) {
                  // Check if it's a reasonable timestamp (after 2001)
                  // If that fails, try parsing as ISO string
                  timestamp = Date.parse(value);
                }

                if (!isNaN(timestamp) && timestamp > 1000000000000) {
                  // Ensure it's a valid recent timestamp
                  lastActivity = new Date(timestamp).toISOString();
                }
              }
            }
          } catch (error) {
            // Fallback to FilterLogEvents with limited pagination
            logger.warn(`CloudWatch Insights failed for stats, using fallback for ${src.name}`, {
              error: error instanceof Error ? error.message : String(error),
            });

            const fle = await client.send(
              new FilterLogEventsCommand({
                logGroupName: logGroup,
                logStreamNames: sourceStreams.length ? sourceStreams.slice(0, 100) : undefined,
                startTime: startMs,
                endTime: endMs,
                limit: 1000, // Reasonable limit for fallback
              })
            );

            const events = fle.events || [];
            if (events.length) {
              const latestEvent = events[events.length - 1];
              if (latestEvent.timestamp) {
                lastActivity = new Date(latestEvent.timestamp).toISOString();
              }
            }
          }
        } catch {
          // Fallback to stream lastIngestionTime if filtering fails
          const last = streams
            .filter((s) => (s.logStreamName || '').includes(suffix))
            .reduce<number | null>((acc, s) => {
              const t = s.lastIngestionTime ?? s.creationTime ?? null;
              if (t === null) {
                return acc;
              }
              if (acc === null) {
                return t;
              }
              return Math.max(acc, t);
            }, null);

          if (last) {
            lastActivity = new Date(last).toISOString();
          }
        }
      }

      stats.push({
        source: src.name,
        count: 0, // CloudWatch doesn't provide easy count without querying
        lastActivity,
      });
    }

    return stats;
  }

  async searchLogs(
    query: string,
    sourceName?: string,
    limit: number = 100,
    _offset = 0 // CloudWatch doesn't support offset-based pagination
  ): Promise<{
    logs: (LogSchema & { source: string })[];
    total: number;
  }> {
    if (!this.cwLogGroup || !this.cwClient) {
      throw new AppError(
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY not found in environment variables',
        500,
        ERROR_CODES.LOGS_AWS_NOT_CONFIGURED
      );
    }
    const client = this.cwClient;
    const logGroup = this.cwLogGroup;
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000; // Default to last 24 hours for better performance

    const escaped = query.replace(/"/g, '\\"');
    let insights = `fields @timestamp, @message, @logStream | filter @message like /${escaped}/`;

    if (sourceName) {
      const suffixMapping = this.getSuffixMapping();
      const suffix =
        suffixMapping[sourceName] || suffixMapping[this.getDisplayName(sourceName)] || '';
      if (suffix) {
        insights += ` | filter @logStream like /${suffix}/`;
      }
    }

    // CloudWatch Insights allows explicit sorting - keeping DESC for search results
    insights += ` | sort @timestamp desc | limit ${limit}`;

    const startQuery = await client.send(
      new StartQueryCommand({
        logGroupName: logGroup,
        startTime: Math.floor(start / 1000),
        endTime: Math.floor(end / 1000),
        queryString: insights,
        limit,
      })
    );

    const qid = startQuery.queryId || '';
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
    const toObj = (row: Array<{ field?: string; value?: string }>) =>
      Object.fromEntries(row.map((c) => [c.field || '', c.value || '']));

    const mapped: (LogSchema & { source: string })[] = rows.map((r) => {
      const o = toObj(r);
      const msg = o['@message'] || '';
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(msg);
      } catch {
        parsed = { message: msg };
      }

      const logStream: string = o['@logStream'] || '';
      const source: string = logStream.includes('postgrest')
        ? 'postgREST.logs'
        : logStream.includes('postgres')
          ? 'postgres.logs'
          : logStream.includes('function')
            ? 'function.logs'
            : 'insforge.logs';

      return {
        id: `${o['@logStream']}-${o['@timestamp']}`,
        // CloudWatch Insights returns timestamp as string in milliseconds
        timestamp: o['@timestamp']
          ? new Date(parseInt(o['@timestamp'])).toISOString()
          : new Date().toISOString(),
        eventMessage:
          typeof parsed === 'object' && (parsed as Record<string, unknown>).msg
            ? String((parsed as Record<string, unknown>).msg)
            : typeof msg === 'string'
              ? msg.slice(0, 500)
              : String(msg),
        body: parsed as Record<string, unknown>,
        source,
      };
    });

    return {
      logs: mapped,
      total: mapped.length,
    };
  }

  async close(): Promise<void> {
    // CloudWatch client doesn't need explicit closing
  }
}
