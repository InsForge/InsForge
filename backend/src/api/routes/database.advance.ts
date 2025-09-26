import { Router, Response } from 'express';
import { DatabaseAdvanceService } from '@/core/database/advance.js';
import { AuditService } from '@/core/logs/audit.js';
import { verifyAdmin, AuthRequest } from '@/api/middleware/auth.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { upload, handleUploadError } from '@/api/middleware/upload.js';
import {
  rawSQLRequestSchema,
  exportRequestSchema,
  importRequestSchema,
  bulkInsertRequestSchema,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger';

const router = Router();
const dbAdvanceService = new DatabaseAdvanceService();
const auditService = AuditService.getInstance();

/**
 * Execute raw SQL query
 * POST /api/database/advance/rawsql
 */
router.post('/rawsql', verifyAdmin, async (req: AuthRequest, res: Response) => {
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
    const response = await dbAdvanceService.executeRawSQL(query, params);

    // Log audit for raw SQL execution
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'EXECUTE_RAW_SQL',
      module: 'DATABASE',
      details: {
        query: query.substring(0, 300), // Limit query length in audit log
        paramCount: params.length,
        rowsAffected: response.rowCount,
      },
      ip_address: req.ip,
    });

    res.json(response);
  } catch (error: unknown) {
    logger.warn('Raw SQL execution error:', error);

    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: 'SQL_EXECUTION_ERROR',
        message: error.message,
        statusCode: error.statusCode,
      });
    } else {
      res.status(400).json({
        error: 'SQL_EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to execute SQL query',
        statusCode: 400,
      });
    }
  }
});

/**
 * Export database data
 * POST /api/database/advance/export
 */
router.post('/export', verifyAdmin, async (req: AuthRequest, res: Response) => {
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

    res.json(response);
  } catch (error: unknown) {
    logger.warn('Database export error:', error);
    res.status(500).json({
      error: 'EXPORT_ERROR',
      message: error instanceof Error ? error.message : 'Failed to export database',
      statusCode: 500,
    });
  }
});

/**
 * Bulk insert data from file upload (CSV/JSON)
 * POST /api/database/advance/bulk-insert
 * Expects multipart/form-data with:
 * - file: CSV or JSON file
 * - table: Target table name
 * - upsertKey: Optional column for upsert operations
 */
router.post(
  '/bulk-insert',
  verifyAdmin,
  upload.single('file'),
  handleUploadError,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        throw new AppError('File is required', 400, ERROR_CODES.INVALID_INPUT);
      }

      // Validate request body
      const validation = bulkInsertRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { table, upsertKey } = validation.data;

      const response = await dbAdvanceService.bulkInsertFromFile(
        table,
        req.file.buffer,
        req.file.originalname,
        upsertKey
      );

      // Log audit
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'BULK_INSERT',
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

      res.json(response);
    } catch (error: unknown) {
      logger.warn('Bulk insert error:', error);

      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          error: 'BULK_INSERT_ERROR',
          message: error.message,
          statusCode: error.statusCode,
        });
      } else {
        res.status(400).json({
          error: 'BULK_INSERT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to perform bulk insert',
          statusCode: 400,
        });
      }
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
  async (req: AuthRequest, res: Response) => {
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

      res.json(response);
    } catch (error: unknown) {
      logger.warn('Database import error:', error);

      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          error: 'IMPORT_ERROR',
          message: error.message,
          statusCode: error.statusCode,
        });
      } else {
        res.status(500).json({
          error: 'IMPORT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to import database',
          statusCode: 500,
        });
      }
    }
  }
);

export default router;
