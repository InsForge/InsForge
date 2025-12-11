import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { DatabaseTableService } from '@/services/database/database-table.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { createTableRequestSchema, updateTableSchemaRequestSchema } from '@insforge/shared-schemas';
import { AuditService } from '@/services/logs/audit.service.js';

const router = Router();
const tableService = DatabaseTableService.getInstance();
const auditService = AuditService.getInstance();

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

// Delete a table
router.delete(
  '/:tableName',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      const result = await tableService.deleteTable(tableName);

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
