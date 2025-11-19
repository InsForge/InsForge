import { DatabaseManager } from '@/infra/database/manager.js';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { AuditLogEntry, AuditLogQuery } from '@/types/logs.js';
import { AuditLogSchema, GetAuditLogStatsResponse } from '@insforge/shared-schemas';

export class AuditService {
  private static instance: AuditService;
  private db: ReturnType<DatabaseManager['getDb']>;

  private constructor() {
    const dbManager = DatabaseManager.getInstance();
    this.db = dbManager.getDb();
    logger.info('AuditService initialized');
  }

  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /**
   * Create a new audit log entry
   */
  async log(entry: AuditLogEntry): Promise<AuditLogSchema> {
    try {
      const result = await this.db
        .prepare(
          `INSERT INTO _audit_logs (actor, action, module, details, ip_address)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`
        )
        .get(
          entry.actor,
          entry.action,
          entry.module,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.ip_address || null
        );

      logger.info('Audit log created', {
        actor: entry.actor,
        action: entry.action,
        module: entry.module,
      });

      return {
        id: result.id,
        actor: result.actor,
        action: result.action,
        module: result.module,
        details: result.details,
        ipAddress: result.ip_address,
        createdAt: result.created_at,
        updatedAt: result.updated_at,
      };
    } catch (error) {
      logger.error('Failed to create audit log', error);
      throw new AppError('Failed to create audit log', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Query audit logs with filters and return both records and total count
   */
  async query(query: AuditLogQuery): Promise<{ records: AuditLogSchema[]; total: number }> {
    try {
      // Build base WHERE clause
      let whereClause = 'WHERE 1=1';
      const params: unknown[] = [];
      let paramIndex = 1;

      if (query.actor) {
        whereClause += ` AND actor = $${paramIndex++}`;
        params.push(query.actor);
      }

      if (query.action) {
        whereClause += ` AND action = $${paramIndex++}`;
        params.push(query.action);
      }

      if (query.module) {
        whereClause += ` AND module = $${paramIndex++}`;
        params.push(query.module);
      }

      if (query.start_date) {
        whereClause += ` AND created_at >= $${paramIndex++}`;
        params.push(query.start_date.toISOString());
      }

      if (query.end_date) {
        whereClause += ` AND created_at <= $${paramIndex++}`;
        params.push(query.end_date.toISOString());
      }

      // Get total count first
      const countSql = `SELECT COUNT(*) as count FROM _audit_logs ${whereClause}`;
      const countResult = (await this.db.prepare(countSql).get(...params)) as { count: number };
      const total = countResult.count;

      // Get paginated records
      let dataSql = `SELECT * FROM _audit_logs ${whereClause} ORDER BY created_at DESC`;
      const dataParams = [...params];

      if (query.limit) {
        dataSql += ` LIMIT $${paramIndex++}`;
        dataParams.push(query.limit);
      }

      if (query.offset) {
        dataSql += ` OFFSET $${paramIndex++}`;
        dataParams.push(query.offset);
      }

      const records = await this.db.prepare(dataSql).all(...dataParams);

      return {
        records: records.map((record) => ({
          id: record.id,
          actor: record.actor,
          action: record.action,
          module: record.module,
          details: record.details,
          ipAddress: record.ip_address,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        })),
        total,
      };
    } catch (error) {
      logger.error('Failed to query audit logs', error);
      throw new AppError('Failed to query audit logs', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get audit log by ID
   */
  async getById(id: string): Promise<AuditLogSchema | null> {
    try {
      const result = await this.db.prepare('SELECT * FROM _audit_logs WHERE id = $1').get(id);

      return result
        ? {
            id: result.id,
            actor: result.actor,
            action: result.action,
            module: result.module,
            details: result.details,
            ipAddress: result.ip_address,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
          }
        : null;
    } catch (error) {
      logger.error('Failed to get audit log by ID', error);
      throw new AppError('Failed to get audit log', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get audit log statistics
   */
  async getStats(days: number = 7): Promise<GetAuditLogStatsResponse> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [totalLogs] = await this.db
        .prepare('SELECT COUNT(*) as count FROM _audit_logs WHERE created_at >= $1')
        .get(startDate.toISOString());

      const [uniqueActors] = await this.db
        .prepare('SELECT COUNT(DISTINCT actor) as count FROM _audit_logs WHERE created_at >= $1')
        .get(startDate.toISOString());

      const [uniqueModules] = await this.db
        .prepare('SELECT COUNT(DISTINCT module) as count FROM _audit_logs WHERE created_at >= $1')
        .get(startDate.toISOString());

      const actionsByModule = await this.db
        .prepare(
          `SELECT module, COUNT(*) as count
           FROM _audit_logs
           WHERE created_at >= $1
           GROUP BY module`
        )
        .all(startDate.toISOString());

      const recentActivity = await this.db
        .prepare(
          `SELECT * FROM _audit_logs
           WHERE created_at >= $1
           ORDER BY created_at DESC
           LIMIT 10`
        )
        .all(startDate.toISOString());

      const moduleStats: Record<string, number> = {};
      actionsByModule.forEach((row: { module: string; count: string }) => {
        moduleStats[row.module] = parseInt(row.count);
      });

      return {
        totalLogs: parseInt(totalLogs?.count || 0),
        uniqueActors: parseInt(uniqueActors?.count || 0),
        uniqueModules: parseInt(uniqueModules?.count || 0),
        actionsByModule: moduleStats,
        recentActivity: recentActivity.map((record) => ({
          id: record.id,
          actor: record.actor,
          action: record.action,
          module: record.module,
          details: record.details,
          ipAddress: record.ip_address,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        })),
      };
    } catch (error) {
      logger.error('Failed to get audit log statistics', error);
      throw new AppError('Failed to get audit statistics', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanup(daysToKeep: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await this.db
        .prepare('DELETE FROM _audit_logs WHERE created_at < $1 RETURNING id')
        .all(cutoffDate.toISOString());

      const deletedCount = result.length;

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} audit logs older than ${daysToKeep} days`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup audit logs', error);
      throw new AppError('Failed to cleanup audit logs', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
