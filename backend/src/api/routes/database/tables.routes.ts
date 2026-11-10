import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { DatabaseTableService } from '@/services/database/database-table.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  createTableRequestSchema,
  updateTableSchemaRequestSchema,
} from '@insforge/shared-schemas';
import { AuditService } from '@/services/logs/audit.service.js';
import {
  normalizeDatabaseSchemaName,
  validateSchemaQueryParam,
} from '@/services/database/helpers.js';

const router = Router();
const tableService = DatabaseTableService.getInstance();
const auditService = AuditService.getInstance();

// All table routes accept either JWT token or API key authentication
// router.use(verifyAdmin);

/**
 * GET /api/database/tables
 *
 * Lists all base table names within the specified database schema (defaults to 'public').
 * Requires admin authentication (JWT or API key).
 */
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    validateSchemaQueryParam(req.query.schema);
    const schemaName = normalizeDatabaseSchemaName(req.query.schema);
    const tables = await tableService.listTables(schemaName);
    successResponse(res, tables);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/database/tables/rls-status
 *
 * Retrieves lightweight RLS status (tableName, schemaName, rlsEnabled) for all
 * ordinary and partitioned tables in the specified schema.
 * Requires admin authentication (JWT or API key).
 */
router.get(
  '/rls-status',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      validateSchemaQueryParam(req.query.schema);
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const statuses = await tableService.getTableRlsStatuses(schemaName);
      successResponse(res, statuses);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/database/tables
 *
 * Creates a new database table with columns, foreign keys, and optional RLS settings.
 * Invalidates column type cache and records an audit log entry upon success.
 * Requires admin authentication (JWT or API key).
 */
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

    validateSchemaQueryParam(req.query.schema);
    const schemaName = normalizeDatabaseSchemaName(req.query.schema);
    const { tableName, columns, foreignKeys, rlsEnabled } = validation.data;
    const result = await tableService.createTable(
      schemaName,
      tableName,
      columns,
      foreignKeys,
      rlsEnabled
    );

    DatabaseManager.clearColumnTypeCache(tableName, schemaName);

    // Log audit for table creation
    await auditService.log({
      actor: req.hasApiKey ? 'api-key' : req.user?.id,
      action: 'CREATE_TABLE',
      module: 'DATABASE',
      details: {
        schemaName,
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

/**
 * GET /api/database/tables/:tableName/schema
 *
 * Introspects and returns the full schema definition for the specified table,
 * including columns, data types, constraints, foreign keys, row count, and RLS status.
 * Requires admin authentication (JWT or API key).
 */
router.get(
  '/:tableName/schema',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      validateSchemaQueryParam(req.query.schema);
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const schema = await tableService.getTableSchema(schemaName, tableName);
      successResponse(res, schema);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/database/tables/:tableName/schema
 *
 * Applies schema modifications (adding/dropping/modifying columns, foreign keys, or renaming)
 * within an admin transaction. Invalidates the column type cache, reloads the PostgREST
 * schema cache, and logs an audit record upon success.
 * Requires admin authentication (JWT or API key).
 */
router.patch(
  '/:tableName/schema',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      validateSchemaQueryParam(req.query.schema);
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);

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
      const result = await tableService.updateTableSchema(schemaName, tableName, operations);

      DatabaseManager.clearColumnTypeCache(tableName, schemaName);

      // Log audit for table schema update
      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPDATE_TABLE',
        module: 'DATABASE',
        details: {
          schemaName,
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
 * DELETE /api/database/tables/:tableName
 *
 * Drops the specified table with CASCADE within an admin transaction.
 * Invalidates the column type cache, reloads the PostgREST schema cache,
 * and records an audit log entry upon success.
 * Requires admin authentication (JWT or API key).
 */
router.delete(
  '/:tableName',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      validateSchemaQueryParam(req.query.schema);
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const result = await tableService.deleteTable(schemaName, tableName);

      DatabaseManager.clearColumnTypeCache(tableName, schemaName);

      // Log audit for table deletion
      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'DELETE_TABLE',
        module: 'DATABASE',
        details: {
          schemaName,
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

/**
 * POST /api/database/tables/:tableName/enable-rls
 *
 * Enables Row Level Security on the specified table in the given schema.
 * Reloads the PostgREST schema cache and logs an audit record upon success.
 * Requires admin authentication (JWT or API key).
 */
router.post(
  '/:tableName/enable-rls',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { tableName } = req.params;
      validateSchemaQueryParam(req.query.schema);
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const result = await tableService.enableTableRLS(schemaName, tableName);

      // Log audit for enabling RLS
      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'UPDATE_TABLE_RLS',
        module: 'DATABASE',
        details: {
          schemaName,
          tableName,
          rlsEnabled: true,
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
