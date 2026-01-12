import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middlewares/error.js';
import { SetEncryptionKeyForClient } from '@/utils/db-encryption-helper.js';
import {
  type CreateScheduleRequest,
  type UpdateScheduleRequest,
  type ScheduleSchema,
} from '@insforge/shared-schemas';
import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'crypto';

import { QueryResult } from 'pg';

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

  private computeNextRunForSchedule(schedule: ScheduleSchema | null): string | null {
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

  private toISOString(date: unknown): string {
    if (!date) {
      return '';
    }
    if (date instanceof Date) {
      return date.toISOString();
    }
    if (typeof date === 'string') {
      return date;
    }
    return String(date);
  }

  private formatScheduleResponse(schedule: ScheduleSchema) {
    return {
      ...schedule,
      lastExecutedAt: schedule.lastExecutedAt ? this.toISOString(schedule.lastExecutedAt) : null,
      createdAt: this.toISOString(schedule.createdAt),
      updatedAt: this.toISOString(schedule.updatedAt),
      nextRun: schedule.nextRun ? this.toISOString(schedule.nextRun) : null,
      isActive: typeof schedule.isActive === 'boolean' ? schedule.isActive : !!schedule.cronJobId,
    };
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
      const result = await this.dbManager.getPool().query(sql);
      const schedules = result.rows as ScheduleSchema[];

      const formatted = schedules.map((s) => {
        const withNextRun = { ...s, nextRun: this.computeNextRunForSchedule(s) };
        return this.formatScheduleResponse(withNextRun);
      });

      logger.info(`Retrieved ${formatted.length} schedules`);
      return formatted;
    } catch (error) {
      logger.error('Error retrieving schedules:', error);
      throw error;
    }
  }

  async getScheduleById(id: string) {
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
      const result = await this.dbManager.getPool().query(sql, [id]);
      const schedule = (result.rows[0] as ScheduleSchema) || null;
      if (!schedule) {
        logger.warn('Schedule not found for ID', { scheduleId: id });
        return null;
      }
      logger.info('Successfully retrieved schedule by ID', { scheduleId: id });
      const withNextRun = { ...schedule, nextRun: this.computeNextRunForSchedule(schedule) };
      return this.formatScheduleResponse(withNextRun);
    } catch (error) {
      logger.error('Error in getScheduleById service', { scheduleId: id, error });
      throw error;
    }
  }

  async createSchedule(data: CreateScheduleRequest) {
    try {
      this.validateCronExpression(data.cronSchedule);

      const scheduleId = randomUUID();
      const resolvedHeaders = data.headers ? await this.resolveHeaderSecrets(data.headers) : {};
      const sql = `
        SELECT * FROM schedules.upsert_job(
          $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, $6::JSONB, $7::JSONB
        )
      `;
      const values = [
        scheduleId,
        data.name,
        data.cronSchedule,
        data.httpMethod,
        data.functionUrl,
        resolvedHeaders,
        data.body || {},
      ];
      const result = await this.queryWithEncryption(sql, values);
      const jobResult = (result.rows && result.rows[0]) as
        | { success?: boolean; cron_job_id?: string; message?: string }
        | undefined;

      if (!jobResult || !jobResult.success) {
        logger.error('Failed to create schedule via database function', {
          scheduleId,
          dbMessage: jobResult?.message,
        });
        throw new AppError(
          jobResult?.message || 'Database operation failed',
          500,
          ERROR_CODES.DATABASE_INTERNAL_ERROR
        );
      }

      logger.info('Successfully created schedule', {
        scheduleId,
        cronJobId: jobResult.cron_job_id,
      });
      return { id: scheduleId, cron_job_id: jobResult.cron_job_id };
    } catch (error) {
      logger.error('Error in createSchedule service', { error });
      throw error;
    }
  }

  async updateSchedule(id: string, data: UpdateScheduleRequest) {
    try {
      const existingSchedule = await this.getScheduleById(id);
      if (!existingSchedule) {
        throw new AppError('Schedule not found', 404, ERROR_CODES.NOT_FOUND);
      }

      // Check if we need to update schedule fields (not just isActive toggle)
      const hasScheduleFields =
        data.name !== undefined ||
        data.cronSchedule !== undefined ||
        data.functionUrl !== undefined ||
        data.httpMethod !== undefined ||
        data.headers !== undefined ||
        data.body !== undefined;

      let cronJobId: string | null | undefined = existingSchedule.cronJobId;

      // Update schedule fields if any provided
      if (hasScheduleFields) {
        const cronSchedule = data.cronSchedule ?? existingSchedule.cronSchedule;
        this.validateCronExpression(cronSchedule);

        const resolvedHeaders = data.headers
          ? await this.resolveHeaderSecrets(data.headers)
          : existingSchedule.headers || {};

        const sql = `
          SELECT * FROM schedules.upsert_job(
            $1::UUID, $2::TEXT, $3::TEXT, $4::TEXT, $5::TEXT, $6::JSONB, $7::JSONB
          )
        `;
        const values = [
          id,
          data.name ?? existingSchedule.name,
          cronSchedule,
          data.httpMethod ?? existingSchedule.httpMethod,
          data.functionUrl ?? existingSchedule.functionUrl,
          resolvedHeaders,
          data.body ?? existingSchedule.body ?? {},
        ];
        const result = await this.queryWithEncryption(sql, values);
        const jobResult = (result.rows && result.rows[0]) as
          | { success?: boolean; cron_job_id?: string; message?: string }
          | undefined;

        if (!jobResult || !jobResult.success) {
          logger.error('Failed to update schedule via database function', {
            scheduleId: id,
            dbMessage: jobResult?.message,
          });
          throw new AppError(
            jobResult?.message || 'Database operation failed',
            500,
            ERROR_CODES.DATABASE_INTERNAL_ERROR
          );
        }
        cronJobId = jobResult.cron_job_id;
      }

      // Handle isActive toggle if provided
      if (data.isActive !== undefined && data.isActive !== existingSchedule.isActive) {
        const toggleSql = data.isActive
          ? 'SELECT * FROM schedules.enable_job($1::UUID)'
          : 'SELECT * FROM schedules.disable_job($1::UUID)';
        await this.queryWithEncryption(toggleSql, [id]);
      }

      logger.info('Successfully updated schedule', { scheduleId: id });
      return { id, cron_job_id: cronJobId };
    } catch (error) {
      logger.error('Error in updateSchedule service', { scheduleId: id, error });
      throw error;
    }
  }

  async deleteSchedule(id: string) {
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
