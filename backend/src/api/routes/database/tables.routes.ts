import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { DatabaseTableService } from '@/services/database/database-table.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptedColumnService } from '@/services/database/encrypted-column.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createTableRequestSchema, updateTableSchemaRequestSchema } from '@insforge/shared-schemas';
import { AuditService } from '@/services/logs/audit.service.js';

const EncryptColumnSchema = z.object({
  column: z.string().min(1, 'Column name is required'),
});

const router = Router();
const tableService = DatabaseTableService.getInstance();
const auditService = AuditService.getInstance();
const encryptedColumnService = EncryptedColumnService.getInstance();

// All table routes accept either JWT token or API key authentication
// router.use(verifyAdmin);

// List all tables
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tables = await tableService.listTables();
    successResponse(res, tables);
  } catch (error) {
    next(error);
  }
});

// Create a new table
router.post('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createTableRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT,
        'Please check the request body, it must conform with the CreateTableRequest schema.'
      );
    }

    const { tableName, columns, rlsEnabled } = validation.data;
    const result = await tableService.createTable(tableName, columns, rlsEnabled);

    DatabaseManager.clearColumnTypeCache(tableName);

    // Log audit for table creation
    await auditService.log({
      actor: req.user?.email || 'api-key',
      action: 'CREATE_TABLE',
      module: 'DATABASE',
      details: {
        tableName,
        columns,
        rlsEnabled,
      },
      ip_address: req.ip,
    });

    successResponse(res, result, 201);
  } catch (error) {
    next(error);
  }
});

// Get table schema
router.get(
  '/:tableName/schema',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      const schema = await tableService.getTableSchema(tableName);
      successResponse(res, schema);
    } catch (error) {
      next(error);
    }
  }
);

// Update table schema
router.patch(
  '/:tableName/schema',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;

      const validation = updateTableSchemaRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT,
          'Please check the request body, it must conform with the UpdateTableRequest schema.'
        );
      }

      const operations = validation.data;
      const result = await tableService.updateTableSchema(tableName, operations);

      DatabaseManager.clearColumnTypeCache(tableName);

      // Log audit for table schema update
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'UPDATE_TABLE',
        module: 'DATABASE',
        details: {
          tableName,
          operations,
        },
        ip_address: req.ip,
      });

      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Encrypt an existing plaintext column.
 * POST /api/database/tables/:tableName/encrypt-column
 *
 * Reads all rows, encrypts the target column, writes back in batches,
 * alters the column type to TEXT, installs the ciphertext-format CHECK
 * constraint, and registers the column in system.encrypted_columns.
 */
router.post(
  '/:tableName/encrypt-column',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      const parseResult = EncryptColumnSchema.safeParse(req.body);

      if (!parseResult.success) {
        throw new AppError(
          parseResult.error.issues.map((e) => e.message).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const { column } = parseResult.data;

      // Verify the table and column exist
      const pool = DatabaseManager.getInstance().getPool();
      const colCheck = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [tableName, column]
      );

      if (colCheck.rows.length === 0) {
        throw new AppError(
          `Column "${column}" not found in table "${tableName}"`,
          404,
          ERROR_CODES.DATABASE_NOT_FOUND
        );
      }

      // Reject if already encrypted
      const existing = await encryptedColumnService.getEncryptedColumns(tableName);
      if (existing.has(column)) {
        throw new AppError(
          `Column "${column}" is already encrypted`,
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      const originalType = colCheck.rows[0].data_type.toLowerCase();
      const rowsMigrated = await encryptedColumnService.migrateColumnToEncrypted(
        tableName,
        column,
        originalType
      );

      // Invalidate caches and notify PostgREST of the schema change
      DatabaseManager.clearColumnTypeCache(tableName);
      await pool.query(`NOTIFY pgrst, 'reload schema'`);

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'ENCRYPT_COLUMN',
        module: 'DATABASE',
        details: { tableName, column, originalType, rowsMigrated },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: `Column "${column}" in table "${tableName}" has been encrypted`,
        rowsMigrated,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete a table
router.delete(
  '/:tableName',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      const result = await tableService.deleteTable(tableName);

      DatabaseManager.clearColumnTypeCache(tableName);

      // Log audit for table deletion
      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'DELETE_TABLE',
        module: 'DATABASE',
        details: {
          tableName,
        },
        ip_address: req.ip,
      });

      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

export { router as databaseTablesRouter };
