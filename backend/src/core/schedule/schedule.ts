import { DatabaseManager } from '@/core/database/manager.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/core/secrets/secrets.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middleware/error.js';
import { SetEncryptionKeyForClient } from '@/utils/db-encryption-helper.js';
import { UpsertScheduleRequest, type Schedule } from '@insforge/shared-schemas';
import { CronExpressionParser } from 'cron-parser';

import { QueryResult } from 'pg';

type UpsertScheduleData = UpsertScheduleRequest & { scheduleId: string };

export class ScheduleService {
  private static instance: ScheduleService;
  private dbManager: DatabaseManager;
  private secretService: SecretService;

  private constructor() {
    this.dbManager = DatabaseManager.getInstance();
    this.secretService = new SecretService();
  }

  // Validate that the cron expression is exactly 5 fields (minute, hour, day, month, day-of-week)
  // pg_cron does not support 6-field expressions with seconds.
  private _validateCronExpression(cronSchedule: string): void {
    const fields = cronSchedule.trim().split(/\s+/);
    // Enforce pg_cron five-field requirement first
    if (fields.length !== 5) {
      throw new AppError(
        `Cron expression must be exactly 5 fields (minute, hour, day, month, day-of-week). Got ${fields.length} fields. Example: "*/5 * * * *" for every 5 minutes.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    // Use cron-parser to perform a thorough syntactic validation. The parser will
    // throw on invalid expressions (invalid ranges, characters, aliases, etc.).
    try {
      CronExpressionParser.parse(cronSchedule, { strict: false });
    } catch (err) {
      // Surface the parser error message to the client for easier debugging
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(`Invalid cron expression: ${msg}`, 400, ERROR_CODES.INVALID_INPUT);
    }
  }

  public static getInstance(): ScheduleService {
    if (!ScheduleService.instance) {
      ScheduleService.instance = new ScheduleService();
    }
    return ScheduleService.instance;
  }

  private async queryWithEncryption(queryText: string, values: unknown[]): Promise<QueryResult> {
    const pool = this.dbManager.getPool();
    if (!pool) {
      logger.error('Database pool not initialized when calling queryWithEncryption');
      throw new AppError('Database service is not available.', 500, ERROR_CODES.DATABASE_NOT_FOUND);
    }
    const client = await pool.connect();
    try {
      await SetEncryptionKeyForClient(client);
      const res = await client.query(queryText, values);
      return res;
    } finally {
      client.release();
    }
  }
  private _computeNextRunForSchedule(s: Schedule | null): string | null {
    try {
      if (!s) {
        return null;
      }
      if (!s.cronSchedule) {
        return null;
      }

      const createdAt = s.createdAt ? new Date(s.createdAt) : null;
      const updatedAt = s.updatedAt ? new Date(s.updatedAt) : null;
      const lastExecutedAt = s.lastExecutedAt ? new Date(s.lastExecutedAt) : null;

      // Determine base date using precedence
      let after: Date;
      if (lastExecutedAt) {
        after = lastExecutedAt;
      } else if (createdAt) {
        after = createdAt;
      } else {
        after = new Date();
      }

      // Override if updatedAt is more recent (cron was modified after the base date)
      if (updatedAt && updatedAt > after) {
        after = updatedAt;
      }

      // Use the library's documented API: CronExpressionParser.parse(...)
      const cronExpression = CronExpressionParser.parse(s.cronSchedule, {
        currentDate: after,
      });
      const nextDate = cronExpression.next();
      return nextDate.toISOString();
    } catch (err) {
      // If parsing fails or values are invalid, return null. Don't throw so listing still succeeds.
      logger.warn('Failed to compute nextRun for schedule', {
        scheduleId: s?.id,
        rawError: String(err),
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      return null;
    }
  }

  private async _resolveHeaderSecrets(
    headers: Record<string, string>
  ): Promise<Record<string, string>> {
    const resolvedHeaders: Record<string, string> = {};
    // This regex finds all occurrences of `secret:KEY` where KEY is a sequence of non-space characters.
    const secretRegex = /secret:(\S+)/g;

    for (const key in headers) {
      let value = headers[key];
      if (typeof value === 'string') {
        const matches = [...value.matchAll(secretRegex)];

        // Asynchronously resolve all secrets found in this single header value
        for (const match of matches) {
          const placeholder = match[0]; // The full match, e.g., "secret:MY_API_KEY"
          const secretKey = match[1]; // The captured group, e.g., "MY_API_KEY"

          const secretValue = await this.secretService.getSecretByKey(secretKey);

          if (secretValue) {
            // Replace the placeholder (e.g., "secret:MY_API_KEY") with the actual secret.
            value = value.replace(placeholder, secretValue);
          } else {
            throw new AppError(
              `Secret with key "${secretKey}" not found for schedule header "${key}".`,
              404,
              ERROR_CODES.NOT_FOUND
            );
          }
        }
      }
      resolvedHeaders[key] = value;
    }
    return resolvedHeaders;
  }

  async listSchedules() {
    try {
      // Use SQL aliasing to map snake_case columns to camelCase properties
      const sql = `
      SELECT
        id,
        name,
        cron_schedule AS "cronSchedule",
        function_url AS "functionUrl",
        http_method AS "httpMethod",
        is_active AS "isActive",
        body,
        headers,
        cron_job_id AS "cronJobId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_executed_at AS "lastExecutedAt"
      FROM _schedules
      ORDER BY created_at DESC
    `;
      const schedules = (await this.dbManager.prepare(sql).all()) as Schedule[];

      // Compute next execution run for each schedule using cron expression and
      // the following precedence for the base date ("after"): lastExecutedAt -> createdAt -> now
      // If updatedAt is greater than the chosen base, use updatedAt instead.
      const enriched = schedules.map((s: Schedule) => ({
        ...s,
        nextRun: this._computeNextRunForSchedule(s),
      }));

      logger.info(`Retrieved ${enriched.length} schedules`);
      return enriched;
    } catch (error) {
      logger.error('Error retrieving schedules:', error);
      throw error;
    }
  }

  async getScheduleById(id: string) {
    if (!id) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      // Use SQL aliasing to map snake_case columns to camelCase properties
      const sql = `
      SELECT
        id,
        name,
        cron_schedule AS "cronSchedule",
        function_url AS "functionUrl",
        http_method AS "httpMethod",
        body,
        headers,
        is_active AS "isActive",
        cron_job_id AS "cronJobId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_executed_at AS "lastExecutedAt"
      FROM _schedules
      WHERE id = ?
    `;
      const schedule = (await this.dbManager.prepare(sql).get(id)) as Schedule | null;
      if (schedule) {
        // compute next run using helper logic
        schedule.nextRun = this._computeNextRunForSchedule(schedule);
      }
      if (schedule) {
        logger.info('Successfully retrieved schedule by ID', { scheduleId: id });
      } else {
        logger.warn('Schedule not found for ID', { scheduleId: id });
      }
      return schedule || null;
    } catch (error) {
      logger.error('Error in getScheduleById service', { scheduleId: id, error });
      throw error;
    }
  }

  async upsertSchedule(data: UpsertScheduleData) {
    try {
      // Validate cron expression before proceeding
      this._validateCronExpression(data.cronSchedule);

      const resolvedHeaders = data.headers ? await this._resolveHeaderSecrets(data.headers) : {};
      const existingSchedule = await this.getScheduleById(data.scheduleId);
      const isCreating = !existingSchedule;
      const sql = `
        SELECT * FROM upsert_cron_schedule(
          $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, $6::JSONB, $7::JSONB
        )
      `;
      const values = [
        data.scheduleId,
        data.name,
        data.cronSchedule,
        data.httpMethod,
        data.functionUrl,
        resolvedHeaders,
        data.body || {},
      ];
      const result = await this.queryWithEncryption(sql, values);
      const jobResult = (result.rows && result.rows[0]) as
        | {
            success?: boolean;
            cron_job_id?: string;
            message?: string;
          }
        | undefined;

      if (!jobResult || !jobResult.success) {
        logger.error('Failed to upsert schedule via database function', {
          scheduleId: data.scheduleId,
          dbMessage: jobResult?.message,
        });
        throw new AppError(
          jobResult?.message || 'Database operation failed',
          500,
          ERROR_CODES.DATABASE_INTERNAL_ERROR
        );
      }

      logger.info('Successfully upserted schedule', {
        scheduleId: data.scheduleId,
        cronJobId: jobResult.cron_job_id,
        operation: isCreating ? 'create' : 'update',
      });
      return { ...jobResult, isCreating };
    } catch (error) {
      logger.error('Error in upsertSchedule service', { scheduleId: data.scheduleId, error });
      throw error;
    }
  }

  async toggleSchedule(id: string, isActive: boolean) {
    if (!id) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (isActive) {
      // Re-enable by creating a cron job using stored schedule fields without re-inserting.
      // Use DB helper enable_cron_schedule which schedules the job and updates cron_job_id/is_active.
      const sql = 'SELECT * FROM enable_cron_schedule($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      return (result.rows && result.rows[0]) as Record<string, unknown>;
    } else {
      // Disable by calling disable_cron_schedule DB function
      const sql = 'SELECT * FROM disable_cron_schedule($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      return (result.rows && result.rows[0]) as Record<string, unknown>;
    }
  }

  async deleteSchedule(id: string) {
    if (!id) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      const sql = 'SELECT * FROM delete_cron_schedule($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      const deleteResult = (result.rows && result.rows[0]) as
        | {
            success?: boolean;
            message?: string;
          }
        | undefined;

      if (!deleteResult || !deleteResult.success) {
        logger.error('Failed to delete schedule via database function', {
          scheduleId: id,
          dbMessage: deleteResult?.message,
        });
        throw new AppError(
          deleteResult?.message || 'Database operation failed',
          500,
          ERROR_CODES.DATABASE_INTERNAL_ERROR
        );
      }

      logger.info('Successfully deleted schedule', { scheduleId: id });
      return deleteResult;
    } catch (error) {
      logger.error('Error in deleteSchedule service', { scheduleId: id, error });
      throw error;
    }
  }

  async getExecutionLogs(scheduleId: string, limit: number = 50, offset: number = 0) {
    if (!scheduleId) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      const sql = `
        SELECT
          id,
          schedule_id AS "scheduleId",
          executed_at AS "executedAt",
          status_code AS "statusCode",
          success,
          duration_ms AS "durationMs",
          message
        FROM _schedule_execution_logs
        WHERE schedule_id = $1::UUID
        ORDER BY executed_at DESC
        LIMIT $2 OFFSET $3
      `;
      type ExecRow = {
        id: string;
        scheduleId: string;
        executedAt: string;
        statusCode: number;
        success: boolean;
        durationMs: string;
        message: string | null;
      };

      const logs = (await this.queryWithEncryption(sql, [
        scheduleId,
        limit,
        offset,
      ])) as QueryResult<ExecRow>;

      // Get total count
      const countSql = `
        SELECT COUNT(*) as total FROM _schedule_execution_logs
        WHERE schedule_id = $1::UUID
      `;
      const countResult = await this.queryWithEncryption(countSql, [scheduleId]);
      const total = parseInt((countResult.rows[0] as { total: string })?.total || '0', 10);

      // Convert string values to proper types
      const formattedLogs = (logs.rows as ExecRow[]).map((log) => {
        // PostgreSQL pg driver converts timestamps to Date objects, so we need to convert back to ISO string
        let executedAtStr: string;
        if (typeof log.executedAt === 'string') {
          executedAtStr = log.executedAt;
        } else if (
          log.executedAt &&
          typeof (log.executedAt as unknown as { toISOString: () => string }).toISOString ===
            'function'
        ) {
          executedAtStr = (log.executedAt as unknown as Date).toISOString();
        } else {
          executedAtStr = String(log.executedAt);
        }
        return {
          id: log.id,
          scheduleId: log.scheduleId,
          executedAt: executedAtStr,
          statusCode: log.statusCode,
          success: log.success,
          durationMs: parseInt(log.durationMs, 10),
          message: log.message,
        };
      });

      logger.info(`Retrieved ${formattedLogs.length} execution logs for schedule`, { scheduleId });
      return {
        logs: formattedLogs,
        total,
        limit,
        offset,
      };
    } catch (error) {
      logger.error('Error retrieving execution logs:', { scheduleId, error });
      throw error;
    }
  }
}
