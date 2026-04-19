import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { EncryptedColumnService } from '@/services/database/encrypted-column.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

const router = Router();
const encryptedColumnService = EncryptedColumnService.getInstance();
const auditService = AuditService.getInstance();

/**
 * List all encrypted columns.
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
 * Re-encrypt all encrypted columns with the current key version.
 * POST /api/database/encryption/rotate
 *
 * Intended to be called after rotating ENCRYPTION_KEY_CURRENT_VERSION to a
 * new version. Re-reads each encrypted value, decrypts with its original
 * key version, and re-encrypts with the current version.
 */
router.post('/rotate', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
});

export { router as encryptionRouter };
