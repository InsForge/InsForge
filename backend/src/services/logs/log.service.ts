import logger from '@/utils/logger.js';
import { CloudWatchProvider } from '@/providers/logs/cloudwatch.provider.js';
import { LocalFileProvider } from '@/providers/logs/local.provider.js';
import { LogProvider } from '@/providers/logs/base.provider.js';
import { LogSchema, LogSourceSchema, LogStatsSchema } from '@insforge/shared-schemas';
import { isCloudEnvironment } from '@/utils/environment.js';
import { DenoSubhostingProvider } from '@/providers/functions/deno-subhosting.provider.js';
import { FunctionService } from '@/services/functions/function.service.js';

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
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) || isCloudEnvironment();

    if (hasAwsCredentials) {
      logger.info('Using log provider: CloudWatch');
      this.provider = new CloudWatchProvider();
    } else {
      logger.info('Using log provider: File-based (no AWS credentials required)');
      this.provider = new LocalFileProvider();
    }

    await this.provider.initialize();
  }

  getLogSources(): Promise<LogSourceSchema[]> {
    return this.provider.getLogSources();
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

    if (isFunctionLogs && denoProvider.isConfigured()) {
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
      return { logs: [], total: 0, tableName: 'deno-subhosting' };
    }

    const result = await denoProvider.getDeploymentAppLogs(deploymentId, {
      limit,
      until: beforeTimestamp,
      order: 'desc',
    });

    const logs: LogSchema[] = result.logs.map((entry, index) => ({
      id: `deno-${deploymentId}-${entry.time}-${index}`,
      timestamp: entry.time,
      eventMessage: entry.message,
      body: {
        level: entry.level,
        region: entry.region,
        message: entry.message,
      },
    }));

    return {
      logs,
      total: logs.length,
      tableName: 'deno-subhosting',
    };
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
}
