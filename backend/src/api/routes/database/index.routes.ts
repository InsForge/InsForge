import { Router, Response, NextFunction } from 'express';
import { databaseTablesRouter } from './tables.routes.js';
import { databaseRecordsRouter } from './records.routes.js';
import { databaseRpcRouter } from './rpc.routes.js';
import databaseAdvanceRouter from './advance.routes.js';
import { databaseMigrationsRouter } from './migrations.routes.js';
import { databaseBackupsRouter } from './backups.routes.js';
import { databaseAdminRouter } from './admin.routes.js';
import { DatabaseService } from '@/services/database/database.service.js';
import { PolicySimulatorService } from '@/services/database/policy-simulator.service.js';
import { AuditService } from '@/services/logs/audit.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, simulatePolicyRequestSchema } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { normalizeDatabaseSchemaName } from '@/services/database/helpers.js';
import { isCloudEnvironment } from '@/utils/environment.js';

const router = Router();
const databaseService = DatabaseService.getInstance();
const policySimulatorService = PolicySimulatorService.getInstance();
const auditService = AuditService.getInstance();

// Mount database sub-routes
router.use('/tables', databaseTablesRouter);
router.use('/records', databaseRecordsRouter);
router.use('/rpc', databaseRpcRouter);
router.use('/advance', databaseAdvanceRouter);
router.use('/migrations', databaseMigrationsRouter);
if (!isCloudEnvironment()) {
  router.use('/backups', databaseBackupsRouter);
}
router.use('/admin', databaseAdminRouter);

router.get(
  '/schemas',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await databaseService.getSchemas();
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get schemas error:', error);
      next(error);
    }
  }
);

/**
 * Get all database functions
 * GET /api/database/functions
 */
router.get(
  '/functions',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const response = await databaseService.getFunctions(schemaName);
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get functions error:', error);
      next(error);
    }
  }
);

/**
 * Get all database indexes
 * GET /api/database/indexes
 */
router.get('/indexes', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const schemaName = normalizeDatabaseSchemaName(req.query.schema);
    const response = await databaseService.getIndexes(schemaName);
    successResponse(res, response);
  } catch (error: unknown) {
    logger.warn('Get indexes error:', error);
    next(error);
  }
});

/**
 * Get all RLS policies
 * GET /api/database/policies
 */
router.get(
  '/policies',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const response = await databaseService.getPolicies(schemaName);
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get policies error:', error);
      next(error);
    }
  }
);

/**
 * Simulate an RLS policy decision for a table operation.
 * POST /api/database/policies/simulate
 *
 * Runs the operation as the chosen role + JWT claims inside a rolled-back
 * transaction (no side effects) and reports allow/deny plus the applicable
 * policies. Admin-only; strictly less powerful than /advance/rawsql.
 */
router.post(
  '/policies/simulate',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = simulatePolicyRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const response = await policySimulatorService.simulate(validation.data);

      await auditService.log({
        actor: req.hasApiKey ? 'api-key' : req.user?.id,
        action: 'SIMULATE_RLS_POLICY',
        module: 'DATABASE',
        details: {
          schema: response.schema,
          table: response.table,
          operation: response.operation,
          role: response.role,
          decision: response.decision,
        },
        ip_address: req.ip,
      });

      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('RLS policy simulation error:', error);
      next(error);
    }
  }
);

/**
 * Get all database triggers
 * GET /api/database/triggers
 */
router.get(
  '/triggers',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const schemaName = normalizeDatabaseSchemaName(req.query.schema);
      const response = await databaseService.getTriggers(schemaName);
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get triggers error:', error);
      next(error);
    }
  }
);

export default router;
