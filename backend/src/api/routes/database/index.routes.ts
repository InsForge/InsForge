import { Router, Response, NextFunction } from 'express';
import { databaseTablesRouter } from './tables.routes.js';
import { databaseRecordsRouter } from './records.routes.js';
import databaseAdvanceRouter from './advance.routes.js';
import { DatabaseService } from '@/services/database/database.service.js';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';

const router = Router();
const databaseService = DatabaseService.getInstance();

// Mount database sub-routes
router.use('/tables', databaseTablesRouter);
router.use('/records', databaseRecordsRouter);
router.use('/advance', databaseAdvanceRouter);

/**
 * Get all database functions
 * GET /api/database/functions
 */
router.get(
  '/functions',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await databaseService.getFunctions();
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
router.get(
  '/indexes',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await databaseService.getIndexes();
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get indexes error:', error);
      next(error);
    }
  }
);

/**
 * Get all RLS policies
 * GET /api/database/policies
 */
router.get(
  '/policies',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await databaseService.getPolicies();
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
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const response = await databaseService.getTriggers();
      successResponse(res, response);
    } catch (error: unknown) {
      logger.warn('Get triggers error:', error);
      next(error);
    }
  }
);

export default router;
