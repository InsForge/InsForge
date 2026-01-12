import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middlewares/error.js';
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
    this.secretService = SecretService.getInstance();
  }

  public static getInstance(): ScheduleService {
    if (!ScheduleService.instance) {
      ScheduleService.instance = new ScheduleService();
    }
    return ScheduleService.instance;
  }

  /**
   * Validate that the cron expression is exactly 5 fields (minute, hour, day, month, day-of-week).
   * pg_cron does not support 6-field expressions with seconds.
   */
  private validateCronExpression(cronSchedule: string): void {
    const fields = cronSchedule.trim().split(/\s+/);
    if (fields.length !== 5) {
      throw new AppError(
        `Cron expression must be exactly 5 fields (minute, hour, day, month, day-of-week). Got ${fields.length} fields. Example: "*/5 * * * *" for every 5 minutes.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    try {
      CronExpressionParser.parse(cronSchedule, { strict: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AppError(`Invalid cron expression: ${msg}`, 400, ERROR_CODES.INVALID_INPUT);
    }
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

  private computeNextRunForSchedule(schedule: Schedule | null): string | null {
    try {
      if (!schedule || !schedule.cronSchedule) {
        return null;
      }

      const createdAt = schedule.createdAt ? new Date(schedule.createdAt) : null;
      const updatedAt = schedule.updatedAt ? new Date(schedule.updatedAt) : null;
      const lastExecutedAt = schedule.lastExecutedAt ? new Date(schedule.lastExecutedAt) : null;

      let after: Date;
      if (lastExecutedAt) {
        after = lastExecutedAt;
      } else if (createdAt) {
        after = createdAt;
      } else {
        after = new Date();
      }

      if (updatedAt && updatedAt > after) {
        after = updatedAt;
      }

      const cronExpression = CronExpressionParser.parse(schedule.cronSchedule, {
        currentDate: after,
      });
      const nextDate = cronExpression.next();
      return nextDate.toISOString();
    } catch (err) {
      logger.warn('Failed to compute nextRun for schedule', {
        scheduleId: schedule?.id,
        rawError: String(err),
        error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
      });
      return null;
    }
  }

  private async resolveHeaderSecrets(
    headers: Record<string, string>
  ): Promise<Record<string, string>> {
    const resolvedHeaders: Record<string, string> = {};
    const secretRegex = /secret:(\S+)/g;

    for (const key in headers) {
      let value = headers[key];
      if (typeof value === 'string') {
        const matches = [...value.matchAll(secretRegex)];

        for (const match of matches) {
          const placeholder = match[0];
          const secretKey = match[1];

          const secretValue = await this.secretService.getSecretByKey(secretKey);

          if (secretValue) {
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
      FROM schedules.jobs
      ORDER BY created_at DESC
    `;
      const pool = this.dbManager.getPool();
      const result = await pool.query(sql);
      const schedules = result.rows as Schedule[];

      const enriched = schedules.map((s: Schedule) => ({
        ...s,
        nextRun: this.computeNextRunForSchedule(s),
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
      FROM schedules.jobs
      WHERE id = $1
    `;
      const pool = this.dbManager.getPool();
      const result = await pool.query(sql, [id]);
      const schedule = (result.rows[0] as Schedule) || null;
      if (schedule) {
        schedule.nextRun = this.computeNextRunForSchedule(schedule);
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
      this.validateCronExpression(data.cronSchedule);

      const resolvedHeaders = data.headers ? await this.resolveHeaderSecrets(data.headers) : {};
      const existingSchedule = await this.getScheduleById(data.scheduleId);
      const isCreating = !existingSchedule;
      const sql = `
        SELECT * FROM schedules.upsert_job(
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
      const sql = 'SELECT * FROM schedules.enable_job($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      return (result.rows && result.rows[0]) as Record<string, unknown>;
    } else {
      const sql = 'SELECT * FROM schedules.disable_job($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      return (result.rows && result.rows[0]) as Record<string, unknown>;
    }
  }

  async deleteSchedule(id: string) {
    if (!id) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      const sql = 'SELECT * FROM schedules.delete_job($1::UUID)';
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
          job_id AS "scheduleId",
          executed_at AS "executedAt",
          status_code AS "statusCode",
          success,
          duration_ms AS "durationMs",
          message
        FROM schedules.job_logs
        WHERE job_id = $1::UUID
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

      const countSql = `
        SELECT COUNT(*) as total FROM schedules.job_logs
        WHERE job_id = $1::UUID
      `;
      const countResult = await this.queryWithEncryption(countSql, [scheduleId]);
      const total = parseInt((countResult.rows[0] as { total: string })?.total || '0', 10);

      const formattedLogs = (logs.rows as ExecRow[]).map((log) => {
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
