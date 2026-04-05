import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { EncryptedColumnService } from '@/services/database/encrypted-column.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

const EncryptColumnSchema = z.object({
  column: z.string().min(1, 'Column name is required'),
});

const router = Router();
const encryptedColumnService = EncryptedColumnService.getInstance();
const auditService = AuditService.getInstance();

/**
 * List all encrypted columns
 * GET /api/database/encryption
 */
router.get('/', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pool = DatabaseManager.getInstance().getPool();
    const result = await pool.query(
      `SELECT id, table_schema, table_name, column_name, original_type, key_version, created_at
       FROM system.encrypted_columns
       ORDER BY table_schema, table_name, column_name`
    );

    successResponse(res, { encryptedColumns: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * Encrypt an existing plaintext column
 * POST /api/database/tables/:tableName/encrypt-column
 *
 * Reads all rows, encrypts the target column value, writes back in batches,
 * alters column type to TEXT, and registers it in system.encrypted_columns.
 */
router.post(
  '/tables/:tableName/encrypt-column',
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

      // Check if already encrypted
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

      // Clear column type cache and notify PostgREST of schema change
      DatabaseManager.clearColumnTypeCache(tableName);
      const pool2 = DatabaseManager.getInstance().getPool();
      await pool2.query(`NOTIFY pgrst, 'reload schema'`);

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

/**
 * Re-encrypt all encrypted columns (key rotation)
 * POST /api/database/encryption/rotate
 *
 * Re-encrypts every encrypted column value with the current ENCRYPTION_KEY.
 * Use after rotating the ENCRYPTION_KEY in environment variables.
 */
router.post(
  '/encryption/rotate',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const pool = DatabaseManager.getInstance().getPool();
      const allColumns = await pool.query(
        `SELECT table_schema, table_name, column_name FROM system.encrypted_columns`
      );

      if (allColumns.rows.length === 0) {
        successResponse(res, {
          success: true,
          message: 'No encrypted columns found — nothing to rotate',
          totalReEncrypted: 0,
        });
        return;
      }

      let totalReEncrypted = 0;
      const details: Array<{
        table: string;
        column: string;
        rowsReEncrypted: number;
      }> = [];

      for (const row of allColumns.rows) {
        const count = await encryptedColumnService.reEncryptColumn(
          row.table_name,
          row.column_name,
          row.table_schema
        );
        totalReEncrypted += count;
        details.push({
          table: `${row.table_schema}.${row.table_name}`,
          column: row.column_name,
          rowsReEncrypted: count,
        });
      }

      await auditService.log({
        actor: req.user?.email || 'api-key',
        action: 'ROTATE_ENCRYPTION_KEY',
        module: 'DATABASE',
        details: { totalReEncrypted, columns: details },
        ip_address: req.ip,
      });

      successResponse(res, {
        success: true,
        message: `Re-encrypted ${totalReEncrypted} rows across ${allColumns.rows.length} columns`,
        totalReEncrypted,
        details,
      });
    } catch (error) {
      next(error);
    }
  }
);

export { router as encryptionRouter };
