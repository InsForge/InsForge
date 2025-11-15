import logger from '@/utils/logger.js';
import { CloudWatchProvider } from './providers/cloudwatch.provider.js';
import { LocalFileProvider } from './providers/file.provider.js';
import { LogProvider } from './providers/base.provider.js';
import { LogSchema, LogSourceSchema, LogStatsSchema } from '@insforge/shared-schemas';
import { isCloudEnvironment } from '@/utils/environment.js';

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

  getLogsBySource(
    sourceName: string,
    limit: number = 100,
    beforeTimestamp?: string
  ): Promise<{
    logs: LogSchema[];
    total: number;
    tableName: string;
  }> {
    return this.provider.getLogsBySource(sourceName, limit, beforeTimestamp);
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
