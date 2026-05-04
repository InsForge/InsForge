import { Router, Response, NextFunction } from 'express';
import { databaseTablesRouter } from './tables.routes.js';
import { databaseRecordsRouter } from './records.routes.js';
import { databaseRpcRouter } from './rpc.routes.js';
import databaseAdvanceRouter from './advance.routes.js';
import { databaseMigrationsRouter } from './migrations.routes.js';
import { databaseAdminRouter } from './admin.routes.js';
import { DatabaseService } from '@/services/database/database.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';
import { normalizeDatabaseSchemaName } from '@/services/database/helpers.js';

const router = Router();
const databaseService = DatabaseService.getInstance();

// Mount database sub-routes
router.use('/tables', databaseTablesRouter);
router.use('/records', databaseRecordsRouter);
router.use('/rpc', databaseRpcRouter);
router.use('/advance', databaseAdvanceRouter);
router.use('/migrations', databaseMigrationsRouter);
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
