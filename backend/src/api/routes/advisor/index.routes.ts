import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseAdvisorService } from '@/services/database/database-advisor.service.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

const router = Router();
const advisorService = DatabaseAdvisorService.getInstance();

router.post('/scan', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scanId = await advisorService.triggerScan('manual');
    successResponse(res, { scanId, message: 'Scan started' }, 201);
  } catch (error: unknown) {
    logger.warn('Trigger advisor scan error:', error);
    next(error);
  }
});

/**
 * Get the latest advisor scan summary.
 * GET /api/advisor/latest
 */
router.get('/latest', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const summary = await advisorService.getLatestScan();
    successResponse(res, summary);
  } catch (error: unknown) {
    logger.warn('Get latest advisor scan error:', error);
    next(error);
  }
});

/**
 * Get findings for the latest advisor scan.
 * GET /api/advisor/issues
 */
router.get('/issues', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const severity = req.query.severity as string | undefined;
    if (severity !== undefined && !['critical', 'warning', 'info'].includes(severity)) {
      throw new AppError(
        'Invalid severity parameter: must be one of critical, warning, info',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const category = req.query.category as string | undefined;
    if (category !== undefined && !['security', 'performance', 'health'].includes(category)) {
      throw new AppError(
        'Invalid category parameter: must be one of security, performance, health',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    let limit: number | undefined;
    if (req.query.limit !== undefined && req.query.limit !== '') {
      limit = Number(req.query.limit);
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new AppError(
          'Invalid limit parameter: must be a positive integer',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    }

    let offset: number | undefined;
    if (req.query.offset !== undefined && req.query.offset !== '') {
      offset = Number(req.query.offset);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new AppError(
          'Invalid offset parameter: must be a non-negative integer',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    }

    const result = await advisorService.getLatestScanIssues({
      severity,
      category,
      limit,
      offset,
    });

    successResponse(res, result);
  } catch (error: unknown) {
    logger.warn('Get advisor issues error:', error);
    next(error);
  }
});

/**
 * Get category and severity counts for the latest scan.
 * GET /api/advisor/category-counts
 */
router.get(
  '/category-counts',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const counts = await advisorService.getLatestScanCategoryCounts();
      successResponse(res, counts);
    } catch (error: unknown) {
      logger.warn('Get advisor category counts error:', error);
      next(error);
    }
  }
);

export { router as advisorRouter };
