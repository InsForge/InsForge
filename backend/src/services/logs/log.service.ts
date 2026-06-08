import logger from '@/utils/logger.js';
import { CloudWatchProvider } from '@/providers/logs/cloudwatch.provider.js';
import { LocalFileProvider } from '@/providers/logs/local.provider.js';
import { LogProvider } from '@/providers/logs/base.provider.js';
import {
  LogSchema,
  LogSourceSchema,
  LogStatsSchema,
  getBuildLogsResponseSchema,
  type GetBuildLogsResponseSchema,
} from '@insforge/shared-schemas';
import { isCloudEnvironment } from '@/utils/environment.js';
import {
  DenoSubhostingProvider,
  type AppLogEntry,
} from '@/providers/functions/deno-subhosting.provider.js';
import { FunctionService } from '@/services/functions/function.service.js';
import { appConfig } from '@/infra/config/app.config.js';

// Re-export the type for backward compatibility
export type GetBuildLogsResponse = GetBuildLogsResponseSchema;

export class LogService {
  private static instance: LogService;
  private provider!: LogProvider;

  private constructor() {}

  static getInstance(): LogService {
    if (!LogService.instance) {
      LogService.instance = new LogService();
    }
    return LogService.instance;
  }

  async initialize(): Promise<void> {
    // Use CloudWatch if AWS credentials are available or if it's cloud environment since we provided the permissions in instance profile
    // otherwise use file-based logging
    const hasAwsCredentials =
      (appConfig.storage.awsAccessKeyId && appConfig.storage.awsSecretAccessKey) ||
      isCloudEnvironment();

    if (hasAwsCredentials) {
      logger.info('Using log provider: CloudWatch');
      this.provider = new CloudWatchProvider();
    } else {
      logger.info('Using log provider: File-based (no AWS credentials required)');
      this.provider = new LocalFileProvider();
    }

    await this.provider.initialize();
  }

  async getLogSources(): Promise<LogSourceSchema[]> {
    const providerSources = await this.provider.getLogSources();
    const denoProvider = DenoSubhostingProvider.getInstance();
    if (denoProvider.isConfigured()) {
      // add function logs to the list of sources, if not already present
      const idCounter = providerSources?.length + 1 || 1;
      const alreadyExists = providerSources.some((s) => s.token === 'function-vector');
      if (!alreadyExists) {
        providerSources.push({
          id: String(idCounter),
          name: 'function.logs',
          token: 'function-vector',
        });
      }
    }
    return providerSources;
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
    // When source is function.logs and Deno Subhosting is configured,
    // fetch app logs from Deno API instead of CloudWatch/local
    const isFunctionLogs = sourceName === 'function.logs' || sourceName === 'deno-relay-logs';
    const denoProvider = DenoSubhostingProvider.getInstance();
    const isDenoConfigured = denoProvider.isConfigured();

    logger.info('getLogsBySource called', {
      sourceName,
      isFunctionLogs,
      isDenoConfigured,
    });

    if (isFunctionLogs && isDenoConfigured) {
      return this.getFunctionLogsFromDeno(limit, beforeTimestamp);
    }

    return this.provider.getLogsBySource(sourceName, limit, beforeTimestamp);
  }

  /**
   * Fetch function runtime logs from Deno Subhosting API
   * and convert to LogSchema format for consistent response
   */
  private async getFunctionLogsFromDeno(
    limit: number,
    beforeTimestamp?: string
  ): Promise<{
    logs: LogSchema[];
    total: number;
    tableName: string;
  }> {
    const functionService = FunctionService.getInstance();
    const denoProvider = DenoSubhostingProvider.getInstance();

    const deploymentId = await functionService.getLatestSuccessfulDeploymentId();
    if (!deploymentId) {
      logger.info('No successful deployment found, cannot fetch function logs from Deno');
      return { logs: [], total: 0, tableName: 'deno-subhosting' };
    }
    logger.info('Fetching function logs from Deno Subhosting', {
      deploymentId,
      limit,
      beforeTimestamp,
    });

    if (!beforeTimestamp) {
      // If no beforeTimestamp provided, set it to current time to fetch latest logs
      beforeTimestamp = new Date().toISOString();
    }

    try {
      const result = await denoProvider.getDeploymentAppLogs(deploymentId, {
        limit,
        // v2 logs are a [start, end] window; `end` caps at the requested
        // beforeTimestamp and the provider defaults `start` to 24h earlier.
        end: beforeTimestamp,
        // Deno's `level` param is an exact-match filter (comma-separated), not a
        // minimum-severity threshold. Omitting it returns all levels (error, warning,
        // info, debug); passing `debug` would return ONLY debug-level entries.
      });

      const logs: LogSchema[] = result.logs.map((entry, index) => {
        const body = this.normalizeFunctionLogBody(entry);
        return {
          id: `deno-${deploymentId}-${entry.time}-${index}`,
          timestamp: entry.time,
          eventMessage: (body.event_message as string) ?? '',
          body,
        };
      });

      return {
        logs,
        total: logs.length,
        tableName: 'deno-subhosting',
      };
    } catch (error) {
      // Log and return empty result instead of throwing to prevent hanging requests
      logger.error('Failed to fetch function logs from Deno', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      return { logs: [], total: 0, tableName: 'deno-subhosting' };
    }
  }

  /**
   * Reshape a Deno runtime log entry into the Vector-style body the dashboard
   * consumes. The dashboard derives the severity badge from
   * `body.metadata.level` and the message column from `body.event_message`, so a
   * flat `{ level, region, message }` body renders every line as "Info" with the
   * raw message text.
   *
   * Deno captures stdout/stderr verbatim via the console API, so the
   * auto-generated router's `console.log(JSON.stringify({ slug, method, status,
   * duration }))` arrives as a JSON string with a trailing newline. Parse it,
   * lift the level into `metadata`, and synthesize a readable access line.
   */
  private normalizeFunctionLogBody(entry: AppLogEntry): Record<string, unknown> {
    const raw = (entry.message ?? '').replace(/\s+$/, '');

    let parsed: Record<string, unknown> | null = null;
    try {
      const obj: unknown = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsed = obj as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    // Level precedence: a `level` embedded in the structured log wins, otherwise
    // the level Deno reports for the line; default to 'info'.
    const structuredLevel =
      parsed && typeof parsed.level === 'string' ? parsed.level.toLowerCase() : undefined;
    const metadata: Record<string, unknown> = { level: structuredLevel ?? entry.level ?? 'info' };
    if (entry.region) {
      metadata.region = entry.region;
    }

    // Non-JSON line (e.g. `console.error("Function error:", err)`): surface the
    // trimmed text as-is.
    if (!parsed) {
      return { event_message: raw, metadata };
    }

    // Keep the parsed fields in the body for the detail panel, minus the ones we
    // hoist into metadata / event_message.
    const { level: _level, metadata: _meta, message: _message, msg: _msg, ...rest } = parsed;

    const fmt = (v: unknown) => (v === undefined || v === null ? '' : String(v));

    // Router request logs carry { slug, method, status, duration }. Synthesize an
    // access line so the column shows `GET my-fn 200 1ms` instead of raw JSON.
    if (
      parsed.method !== undefined ||
      parsed.status !== undefined ||
      parsed.duration !== undefined
    ) {
      const target = typeof parsed.slug === 'string' ? parsed.slug : fmt(parsed.path);
      const requestLine = [fmt(parsed.method), target, fmt(parsed.status), fmt(parsed.duration)]
        .filter((part) => part !== '')
        .join(' ');
      return { ...rest, event_message: requestLine || raw, metadata };
    }

    // Other structured logs: surface the `message`/`msg` field when present,
    // otherwise fall back to the cleaned JSON so nothing is lost.
    const msgField =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.msg === 'string'
          ? parsed.msg
          : raw;
    return { ...rest, event_message: msgField, metadata };
  }

  getLogSourceStats(): Promise<LogStatsSchema[]> {
    return this.provider.getLogSourceStats();
  }

  searchLogs(
    query: string,
    sourceName?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    logs: (LogSchema & { source: string })[];
    total: number;
  }> {
    return this.provider.searchLogs(query, sourceName, limit, offset);
  }

  async close(): Promise<void> {
    await this.provider.close();
  }

  /**
   * Get build logs for the latest deployment or a specific deployment
   */
  async getBuildLogs(deploymentId?: string): Promise<GetBuildLogsResponse | null> {
    const denoProvider = DenoSubhostingProvider.getInstance();

    if (!denoProvider.isConfigured()) {
      logger.info('Deno Subhosting not configured, cannot fetch build logs');
      return null;
    }

    const functionService = FunctionService.getInstance();
    let targetDeploymentId: string | undefined = deploymentId;

    try {
      // If no deploymentId provided, get the latest one
      if (!targetDeploymentId) {
        const latestDeploymentId = await functionService.getLatestDeploymentId();
        if (!latestDeploymentId) {
          logger.info('No deployment found');
          return null;
        }
        targetDeploymentId = latestDeploymentId;
      }

      // Get deployment details
      const deployment = await denoProvider.getDeployment(targetDeploymentId);

      // Get build logs
      const logs = await denoProvider.getDeploymentBuildLogs(targetDeploymentId);

      const response = {
        deploymentId: targetDeploymentId,
        status: deployment.status,
        logs,
        createdAt: deployment.createdAt.toISOString(),
      };

      // Validate response against schema
      const parseResult = getBuildLogsResponseSchema.safeParse(response);
      if (!parseResult.success) {
        logger.error('Build logs response validation failed', {
          error: parseResult.error.message,
          deploymentId: targetDeploymentId,
        });
        throw new Error(`Invalid build logs response: ${parseResult.error.message}`);
      }

      return parseResult.data;
    } catch (error) {
      logger.error('Failed to get build logs', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId: targetDeploymentId,
      });
      return null;
    }
  }
}
