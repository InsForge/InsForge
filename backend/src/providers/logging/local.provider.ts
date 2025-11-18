import { promises as fs, createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { LogSchema, LogSourceSchema, LogStatsSchema } from '@insforge/shared-schemas';
import { BaseLogProvider } from './base.provider.js';
import logger from '@/utils/logger.js';

export class LocalFileProvider extends BaseLogProvider {
  private logsDir: string = '';
  private logFiles: Record<string, string> = {
    'insforge.logs': 'insforge.logs.jsonl',
    'postgres.logs': 'postgres.logs.jsonl',
    'postgREST.logs': 'postgrest.logs.jsonl',
    'function.logs': 'function.logs.jsonl',
  };

  async initialize(): Promise<void> {
    this.logsDir = process.env.LOGS_DIR || path.resolve(process.cwd(), 'insforge-logs');
    try {
      await fs.mkdir(this.logsDir, { recursive: true });
    } catch {
      // Directory already exists
    }
    logger.info(`File-based analytics initialized at: ${this.logsDir}`);
  }

  getLogSources(): Promise<LogSourceSchema[]> {
    const sources: LogSourceSchema[] = [];
    let id = 1;

    for (const [name, filename] of Object.entries(this.logFiles)) {
      sources.push({ id: String(id++), name, token: filename });
    }

    return Promise.resolve(sources);
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
    const filename = this.logFiles[sourceName];
    if (!filename) {
      return { logs: [], total: 0, tableName: sourceName };
    }

    const filePath = path.join(this.logsDir, filename);
    const logs = await this.readLogsFromFile(filePath, limit, beforeTimestamp);

    return {
      logs,
      total: logs.length,
      tableName: sourceName,
    };
  }

  private async readLogsFromFile(
    filePath: string,
    limit: number,
    beforeTimestamp?: string
  ): Promise<LogSchema[]> {
    try {
      await fs.access(filePath);
    } catch {
      return [];
    }

    const logs: LogSchema[] = [];
    const beforeMs = beforeTimestamp ? Date.parse(beforeTimestamp) : Date.now();

    const fileStream = createReadStream(filePath);
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      try {
        const log = JSON.parse(line);

        // Only process Vector-transformed logs (have appname field)
        if (!log.appname) {
          continue;
        }

        const logTime = new Date(log.timestamp).getTime();

        if (logTime < beforeMs) {
          // For error logs, include error and stack in eventMessage to match CloudWatch display
          let eventMessage = log.event_message || '';
          if (log.level === 'error' && log.error) {
            eventMessage = `${eventMessage}\n\nError: ${log.error}`;
            if (log.stack) {
              eventMessage += `\n\nStack Trace:\n${log.stack}`;
            }
          }

          logs.push({
            id: `${logTime}-${Math.random()}`,
            timestamp: log.timestamp,
            eventMessage,
            body: log,
          });
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    // Return most recent logs up to limit
    return logs.slice(-limit);
  }

  async getLogSourceStats(): Promise<LogStatsSchema[]> {
    const stats: LogStatsSchema[] = [];

    for (const [name, filename] of Object.entries(this.logFiles)) {
      const filePath = path.join(this.logsDir, filename);
      try {
        const fileStats = await fs.stat(filePath);
        const logs = await this.readLogsFromFile(filePath, 1000);

        stats.push({
          source: name,
          count: logs.length,
          lastActivity: fileStats.mtime.toISOString(),
        });
      } catch {
        // File doesn't exist
      }
    }

    return stats;
  }

  async searchLogs(
    query: string,
    sourceName?: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    logs: (LogSchema & { source: string })[];
    total: number;
  }> {
    const results: (LogSchema & { source: string })[] = [];
    const searchLower = query.toLowerCase();

    const filesToSearch = sourceName
      ? [{ name: sourceName, filename: this.logFiles[sourceName] }]
      : Object.entries(this.logFiles).map(([name, filename]) => ({ name, filename }));

    for (const { name, filename } of filesToSearch) {
      if (!filename) {
        continue;
      }

      const filePath = path.join(this.logsDir, filename);
      const logs = await this.readLogsFromFile(filePath, 10000);

      for (const log of logs) {
        const messageMatch = log.eventMessage.toLowerCase().includes(searchLower);
        const metadataMatch = JSON.stringify(log.body).toLowerCase().includes(searchLower);

        if (messageMatch || metadataMatch) {
          results.push({ ...log, source: name });
        }
      }
    }

    return {
      logs: results.slice(offset, offset + limit),
      total: results.length,
    };
  }

  async close(): Promise<void> {
    // No cleanup needed for file-based provider
  }
}
