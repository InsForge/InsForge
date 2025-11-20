import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { AuditLogEntry, AuditLogQuery } from '@/types/logs.js';
import { AuditLogSchema, GetAuditLogStatsResponse } from '@insforge/shared-schemas';

export class AuditService {
  private static instance: AuditService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('AuditService initialized');
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
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
      const pool = this.getPool();
      const result = await pool.query(
        `INSERT INTO _audit_logs (actor, action, module, details, ip_address)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          entry.actor,
          entry.action,
          entry.module,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.ip_address || null,
        ]
      );

      const row = result.rows[0];

      logger.info('Audit log created', {
        actor: entry.actor,
        action: entry.action,
        module: entry.module,
      });

      return {
        id: row.id,
        actor: row.actor,
        action: row.action,
        module: row.module,
        details: row.details,
        ipAddress: row.ip_address,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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
      const pool = this.getPool();

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
      const countResult = await pool.query(countSql, params);
      const total = parseInt(countResult.rows[0].count, 10);

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

      const dataResult = await pool.query(dataSql, dataParams);

      return {
        records: dataResult.rows.map((record) => ({
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
      const pool = this.getPool();
      const result = await pool.query('SELECT * FROM _audit_logs WHERE id = $1', [id]);

      const row = result.rows[0];

      return row
        ? {
            id: row.id,
            actor: row.actor,
            action: row.action,
            module: row.module,
            details: row.details,
            ipAddress: row.ip_address,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
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
      const pool = this.getPool();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const totalLogsResult = await pool.query(
        'SELECT COUNT(*) as count FROM _audit_logs WHERE created_at >= $1',
        [startDate.toISOString()]
      );

      const uniqueActorsResult = await pool.query(
        'SELECT COUNT(DISTINCT actor) as count FROM _audit_logs WHERE created_at >= $1',
        [startDate.toISOString()]
      );

      const uniqueModulesResult = await pool.query(
        'SELECT COUNT(DISTINCT module) as count FROM _audit_logs WHERE created_at >= $1',
        [startDate.toISOString()]
      );

      const actionsByModuleResult = await pool.query(
        `SELECT module, COUNT(*) as count
         FROM _audit_logs
         WHERE created_at >= $1
         GROUP BY module`,
        [startDate.toISOString()]
      );

      const recentActivityResult = await pool.query(
        `SELECT * FROM _audit_logs
         WHERE created_at >= $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [startDate.toISOString()]
      );

      const moduleStats: Record<string, number> = {};
      actionsByModuleResult.rows.forEach((row: { module: string; count: string }) => {
        moduleStats[row.module] = parseInt(row.count, 10);
      });

      return {
        totalLogs: parseInt(totalLogsResult.rows[0]?.count || '0', 10),
        uniqueActors: parseInt(uniqueActorsResult.rows[0]?.count || '0', 10),
        uniqueModules: parseInt(uniqueModulesResult.rows[0]?.count || '0', 10),
        actionsByModule: moduleStats,
        recentActivity: recentActivityResult.rows.map((record) => ({
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
      const pool = this.getPool();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const result = await pool.query(
        'DELETE FROM _audit_logs WHERE created_at < $1 RETURNING id',
        [cutoffDate.toISOString()]
      );

      const deletedCount = result.rows.length;

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
