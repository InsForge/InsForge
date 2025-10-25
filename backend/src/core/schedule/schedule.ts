import { DatabaseManager } from '@/core/database/manager.js';
import logger from '@/utils/logger.js';
import { SecretService } from '@/core/secrets/secrets.js';
import { ERROR_CODES } from '@/types/error-constants';
import { AppError } from '@/api/middleware/error.js';
import { SetEncryptionKeyForClient } from '@/utils/db-encryption-helper.js';
import { UpsertScheduleRequest } from '@insforge/shared-schemas';
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
        cron_job_id AS "cronJobId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_executed_at AS "lastExecutedAt"
      FROM _schedules
      ORDER BY created_at DESC
    `;
      const schedules = await this.dbManager.prepare(sql).all();
      logger.info(`Retrieved ${schedules.length} schedules`);
      return schedules;
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
        cron_job_id AS "cronJobId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_executed_at AS "lastExecutedAt"
      FROM _schedules
      WHERE id = ?
    `;
      const schedule = await this.dbManager.prepare(sql).get(id);
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
      const jobResult = result.rows[0];

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

  async deleteSchedule(id: string) {
    if (!id) {
      throw new AppError('Invalid schedule ID provided.', 400, ERROR_CODES.INVALID_INPUT);
    }
    try {
      const sql = 'SELECT * FROM delete_cron_schedule($1::UUID)';
      const result = await this.queryWithEncryption(sql, [id]);
      const deleteResult = result.rows[0];

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
      const logs = await this.queryWithEncryption(sql, [scheduleId, limit, offset]);

      // Get total count
      const countSql = `
        SELECT COUNT(*) as total FROM _schedule_execution_logs
        WHERE schedule_id = $1::UUID
      `;
      const countResult = await this.queryWithEncryption(countSql, [scheduleId]);
      const total = parseInt(countResult.rows[0]?.total || '0', 10);

      // Convert string values to proper types
      const formattedLogs = logs.rows.map((log) => ({
        id: log.id,
        scheduleId: log.scheduleId,
        executedAt: log.executedAt,
        statusCode: log.statusCode,
        success: log.success,
        durationMs: parseInt(log.durationMs, 10),
        message: log.message,
      }));

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
