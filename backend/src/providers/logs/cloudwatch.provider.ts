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
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { LogSchema, LogSourceSchema, LogStatsSchema } from '@insforge/shared-schemas';

export class CloudWatchProvider extends BaseLogProvider {
  private cwClient: CloudWatchLogsClient | null = null;
  private cwLogGroup: string | null = null;
  private cwRegion: string | null = null;

  async initialize(): Promise<void> {
    this.cwRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2';
    // Mirrors the old Vector group_name: /insforge/${PROJECT_ID}. An explicit
    // CLOUDWATCH_LOG_GROUP still wins so operators can point at a custom group.
    const projectId = process.env.PROJECT_ID?.trim();
    this.cwLogGroup =
      process.env.CLOUDWATCH_LOG_GROUP ||
      (projectId ? `/insforge/${projectId}` : '/insforge/local');

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
      const body = this.normalizeBody(message, sourceName);
      const eventMessage =
        typeof body.event_message === 'string'
          ? body.event_message
          : typeof message === 'string'
            ? message.slice(0, 500)
            : String(message);

      return {
        id: e.eventId || `${e.logStreamName || ''}-${e.timestamp || ''}`,
        // CloudWatch timestamp is in milliseconds
        timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString(),
        eventMessage,
        body,
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

      const logStream: string = o['@logStream'] || '';
      const source: string = logStream.includes('postgrest')
        ? 'postgREST.logs'
        : logStream.includes('postgres')
          ? 'postgres.logs'
          : logStream.includes('function')
            ? 'function.logs'
            : 'insforge.logs';

      const body = this.normalizeBody(msg, source);
      const eventMessage =
        typeof body.event_message === 'string'
          ? body.event_message
          : typeof msg === 'string'
            ? msg.slice(0, 500)
            : String(msg);

      return {
        id: `${o['@logStream']}-${o['@timestamp']}`,
        // CloudWatch Insights returns timestamp as string in milliseconds
        timestamp: o['@timestamp']
          ? new Date(parseInt(o['@timestamp'])).toISOString()
          : new Date().toISOString(),
        eventMessage,
        body,
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

  // Reshape a CloudWatch log line into the Vector-style body the dashboard
  // historically consumed: { event_message, metadata: { level, ... }, ... }.
  // The dashboard derives the severity badge from body.metadata.level, so any
  // structured `level` field must be lifted into that nested location.
  private normalizeBody(rawMessage: string, sourceName: string): Record<string, unknown> {
    const message = rawMessage || '';

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;

      // Already in Vector shape: must carry both metadata.level (drives the
      // severity badge) and event_message (the dashboard's primary text
      // column). Letting an appname-only payload through here would leak rows
      // with no event_message and the dashboard would render the raw JSON.
      const meta =
        obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)
          ? (obj.metadata as Record<string, unknown>)
          : undefined;
      const metaLevel = meta && typeof meta.level === 'string' ? meta.level : undefined;
      if (metaLevel && typeof obj.event_message === 'string') {
        return obj;
      }

      // Winston-style structured log from the insforge backend:
      // {"level":"error","message":"...","timestamp":"...","metadata":{...},"stack":"..."}
      const level = typeof obj.level === 'string' ? obj.level.toLowerCase() : undefined;
      const msgField =
        typeof obj.message === 'string'
          ? obj.message
          : typeof obj.msg === 'string'
            ? (obj.msg as string)
            : '';

      const existingMeta = meta ? { ...meta } : {};
      if (level !== undefined) {
        existingMeta.level = level;
      } else if (typeof existingMeta.level !== 'string') {
        // Default to info so the dashboard's severity getter has a value
        // instead of falling through to "informational" by chance.
        existingMeta.level = 'info';
      }

      const { message: _m, msg: _msg, level: _l, metadata: _meta, ...rest } = obj;

      // Request logs: backend HTTP middleware tags every line with a `duration`
      // field. Mirror Vector's request branch — flatten the request fields and
      // synthesize the nginx-style access line so the dashboard column shows
      // method/path/status instead of raw JSON.
      if (obj.duration !== undefined && obj.duration !== null) {
        const method = typeof obj.method === 'string' ? obj.method : '';
        const path = typeof obj.path === 'string' ? obj.path : '';
        const status = obj.status;
        const size = obj.size;
        const duration = obj.duration;
        const ip = typeof obj.ip === 'string' ? obj.ip : '';
        const userAgent = typeof obj.userAgent === 'string' ? obj.userAgent : '';

        const fmt = (v: unknown) => (v === undefined || v === null ? '' : String(v));
        const requestLine = [
          method,
          path,
          fmt(status),
          fmt(size),
          fmt(duration),
          '-',
          ip,
          '-',
          userAgent,
        ].join(' ');

        const {
          method: _mh,
          path: _ph,
          status: _st,
          size: _sz,
          duration: _du,
          ip: _ip,
          userAgent: _ua,
          ...restNoReq
        } = rest;

        return {
          ...restNoReq,
          method,
          path,
          status_code: status,
          size,
          duration,
          ip,
          user_agent: userAgent,
          event_message: requestLine,
          metadata: existingMeta,
        };
      }

      // Application logs: prefix the level so the dashboard message column
      // reads `info - some message`, matching Vector's
      // `join!([req.level, req.message], " - ")`. Leaves `error`/`stack` as
      // top-level keys in the body for the detail panel.
      const eventMessage = level !== undefined && msgField ? `${level} - ${msgField}` : msgField;

      return {
        ...rest,
        event_message: eventMessage || message,
        metadata: existingMeta,
      };
    }

    // Raw text line (no JSON). Apply per-source parsing that mirrors the
    // original Vector remap rules so the dashboard's severity inference still
    // works for postgres/postgREST stdout lines.
    return this.parseRawLine(message, sourceName);
  }

  private parseRawLine(message: string, sourceName: string): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    // Strip the [backend] prefix that the insforge container historically wrote.
    const stripped = message.replace(/^\[backend\]\s*/, '');

    if (sourceName === 'postgres.logs') {
      const m = stripped.match(
        /^(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) (?<tz>\w+) \[(?<pid>\d+)\] (?<level>LOG|ERROR|WARNING|INFO|NOTICE|FATAL|PANIC|STATEMENT|DETAIL): (?<msg>.*)$/s
      );
      if (m && m.groups) {
        // FATAL/PANIC are higher severity than ERROR in postgres but the
        // dashboard only knows error/warn/info — promote them to error so
        // they don't silently render as informational. STATEMENT/DETAIL are
        // continuation lines for a preceding ERROR; treat them as info.
        let level = m.groups.level.toLowerCase();
        if (level === 'statement' || level === 'detail') {
          level = 'info';
        } else if (level === 'fatal' || level === 'panic') {
          level = 'error';
        } else if (level === 'warning') {
          level = 'warn';
        }
        metadata.level = level;
        metadata.parsed = { pid: m.groups.pid };
        return { event_message: m.groups.msg, metadata };
      }
      metadata.level = 'log';
      return { event_message: stripped, metadata };
    }

    if (sourceName === 'postgREST.logs') {
      // PostgREST prefixes *every* line (access logs AND operational errors
      // like "Failed to load the schema cache", upstream FATAL forwards, etc.)
      // with the same `DD/Mon/YYYY:HH:MM:SS +ZZZZ: ` timestamp. Strip the
      // prefix for display, then keyword-infer the severity from the payload
      // so errors don't all collapse to info.
      const m = stripped.match(
        /^(?<time>\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4}): (?<msg>.*)$/s
      );
      const payload = m && m.groups ? m.groups.msg : stripped;
      return this.inferLevelFromText(payload);
    }

    if (sourceName === 'function.logs') {
      const m = stripped.match(/^(?<time>\d+:\d+:\d+\.\d+) \[(?<level>\w+)\] (?<msg>.*)$/s);
      if (m && m.groups) {
        metadata.level = m.groups.level.toLowerCase();
        return { event_message: m.groups.msg, metadata };
      }
    }

    // Conservative severity inference for anything else.
    return this.inferLevelFromText(stripped);
  }

  private inferLevelFromText(text: string): Record<string, unknown> {
    const lower = text.toLowerCase();
    let level: string;
    if (/\b(error|exception|fatal|panic)\b/.test(lower)) {
      level = 'error';
    } else if (/\b(warn|warning)\b/.test(lower)) {
      level = 'warn';
    } else {
      level = 'info';
    }
    return { event_message: text, metadata: { level } };
  }
}
