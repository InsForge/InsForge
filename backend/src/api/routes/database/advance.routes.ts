import { Router, Response, NextFunction } from 'express';
import { DatabaseAdvanceService } from '@/services/database/database-advance.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { upload, handleUploadError } from '@/api/middlewares/upload.js';
import {
  rawSQLRequestSchema,
  exportRequestSchema,
  importRequestSchema,
  bulkUpsertRequestSchema,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { DataUpdateResourceType, ServerEvents } from '@/types/socket.js';
import { successResponse } from '@/utils/response.js';
import { analyzeQuery } from '@/utils/sql-parser.js';

const router = Router();
const dbAdvanceService = DatabaseAdvanceService.getInstance();
const auditService = AuditService.getInstance();

/**
 * Execute raw SQL query with relaxed sanitization (Power User Mode)
 * POST /api/database/advance/rawsql/unrestricted
 *
 * ⚠️ This endpoint has relaxed restrictions compared to /rawsql
 * - Allows SELECT and INSERT into system tables and users table
 */
router.post(
  '/rawsql/unrestricted',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validation = rawSQLRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { query, params = [] } = validation.data;

      // Sanitize query with relaxed mode
      const sanitizedQuery = dbAdvanceService.sanitizeQuery(query, 'relaxed');

      // Execute SQL
      const response = await dbAdvanceService.executeRawSQL(sanitizedQuery, params);

      // Log audit for relaxed raw SQL execution
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'EXECUTE_RAW_SQL_RELAXED',
        module: 'DATABASE',
        details: {
          query: query.substring(0, 300), // Limit query length in audit log
          paramCount: params.length,
          rowsAffected: response.rowCount,
          mode: 'relaxed',
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.DATABASE },
        'system',
        JSON.stringify({ data: { changes: analyzeQuery(query) } })
      );

      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Relaxed raw SQL execution error:', error);
      next(error);
    }
  }
);

/**
 * Execute raw SQL query with strict sanitization
 * POST /api/database/advance/rawsql
 */
router.post('/rawsql', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    const validation = rawSQLRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { query, params = [] } = validation.data;

    // Sanitize query with strict mode
    const sanitizedQuery = dbAdvanceService.sanitizeQuery(query, 'strict');

    // Execute SQL
    const response = await dbAdvanceService.executeRawSQL(sanitizedQuery, params);

    // Log audit for strict raw SQL execution
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'EXECUTE_RAW_SQL',
      module: 'DATABASE',
      details: {
        query: query.substring(0, 300), // Limit query length in audit log
        paramCount: params.length,
        rowsAffected: response.rowCount,
        mode: 'strict',
      },
      ip_address: req.ip,
    });

    const socket = SocketManager.getInstance();
    socket.broadcastToRoom(
      'role:project_admin',
      ServerEvents.DATA_UPDATE,
      { resource: DataUpdateResourceType.DATABASE },
      'system',
      JSON.stringify({ data: { changes: analyzeQuery(query) } })
    );

    successResponse(res, response);
  } catch (error: unknown) {
    logger.warn('Raw SQL execution error:', error);
    next(error);
  }
});

/**
 * Export database data
 * POST /api/database/advance/export
 */
router.post('/export', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Validate request body
    const validation = exportRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const {
      tables,
      format,
      includeData,
      includeFunctions,
      includeSequences,
      includeViews,
      rowLimit,
    } = validation.data;
    const response = await dbAdvanceService.exportDatabase(
      tables,
      format,
      includeData,
      includeFunctions,
      includeSequences,
      includeViews,
      rowLimit
    );

    // Log audit for database export
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'EXPORT_DATABASE',
      module: 'DATABASE',
      details: {
        format: response.format,
      },
      ip_address: req.ip,
    });

    successResponse(res, response);
  } catch (error: unknown) {
    logger.warn('Database export error:', error);
    next(error);
  }
});

/**
 * Bulk upsert data from file upload (CSV/JSON)
 * POST /api/database/advance/bulk-upsert
 * Expects multipart/form-data with:
 * - file: CSV or JSON file
 * - table: Target table name
 * - upsertKey: Optional column for upsert operations
 */
router.post(
  '/bulk-upsert',
  verifyAdmin,
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Validate request body
      const validation = bulkUpsertRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { table, upsertKey } = validation.data;

      const response = await dbAdvanceService.bulkUpsertFromFile(
        table,
        req.file.buffer,
        req.file.originalname,
        upsertKey
      );

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'BULK_UPSERT',
        module: 'DATABASE',
        details: {
          table,
          filename: req.file.originalname,
          fileSize: req.file.size,
          upsertKey: upsertKey || null,
          rowsAffected: response.rowsAffected,
          totalRecords: response.totalRecords,
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.RECORDS, data: { tableName: table } },
        'system'
      );

      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Bulk upsert error:', error);

      next(error);
    }
  }
);

/**
 * Import database data from SQL file
 * POST /api/database/advance/import
 * Expects a SQL file upload via multipart/form-data
 */
router.post(
  '/import',
  verifyAdmin,
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const validation = importRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { truncate } = validation.data;

      if (!req.file) {
        throw new AppError('SQL file is required', 400, ERROR_CODES.INVALID_INPUT);
      }

      const response = await dbAdvanceService.importDatabase(
        req.file.buffer,
        req.file.originalname,
        req.file.size,
        truncate
      );

      // Log audit for database import
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'IMPORT_DATABASE',
        module: 'DATABASE',
        details: {
          truncate,
          filename: response.filename,
          fileSize: response.fileSize,
          tablesAffected: response.tables.length,
          rowsImported: response.rowsImported,
        },
        ip_address: req.ip,
      });

      const socket = SocketManager.getInstance();
      socket.broadcastToRoom(
        'role:project_admin',
        ServerEvents.DATA_UPDATE,
        { resource: DataUpdateResourceType.DATABASE },
        'system'
      );

      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Database import error:', error);
      next(error);
    }
  }
);

export default router;
