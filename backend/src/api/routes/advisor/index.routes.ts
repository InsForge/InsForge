import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { DatabaseAdvisorService } from '@/services/database/database-advisor.service.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { SUPPRESSION_SCOPES, SUPPRESSION_REASONS } from '@/types/advisor.js';

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
 * List all suppressions (the Ignored view).
 * GET /api/advisor/suppressions
 */
router.get(
  '/suppressions',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const suppressions = await advisorService.listSuppressions();
      successResponse(res, { suppressions });
    } catch (error: unknown) {
      logger.warn('List advisor suppressions error:', error);
      next(error);
    }
  }
);

/**
 * Suppress a finding (instance fingerprint) or a whole rule.
 * POST /api/advisor/suppressions
 */
router.post(
  '/suppressions',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { ruleId, affectedObject, scope, reason, note } = req.body ?? {};
      if (typeof ruleId !== 'string' || ruleId.length === 0 || ruleId.length > 200) {
        throw new AppError(
          'Invalid ruleId: must be a non-empty string',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      if (!SUPPRESSION_SCOPES.includes(scope)) {
        throw new AppError(
          'Invalid scope: must be one of instance, rule',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      if (!SUPPRESSION_REASONS.includes(reason)) {
        throw new AppError(
          'Invalid reason: must be one of false_positive, accepted_risk, wont_fix',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      if (
        scope === 'instance' &&
        (typeof affectedObject !== 'string' || affectedObject.length === 0)
      ) {
        throw new AppError(
          'Invalid affectedObject: required for instance scope',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
        throw new AppError(
          'Invalid note: must be a string of at most 1000 characters',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      const suppression = await advisorService.createSuppression({
        ruleId,
        affectedObject: scope === 'instance' ? affectedObject : null,
        scope,
        reason,
        note: note ?? null,
      });
      successResponse(res, suppression, 201);
    } catch (error: unknown) {
      logger.warn('Create advisor suppression error:', error);
      next(error);
    }
  }
);

/**
 * Restore (un-suppress).
 * DELETE /api/advisor/suppressions/:id
 */
router.delete(
  '/suppressions/:id',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const deleted = await advisorService.deleteSuppression(req.params.id);
      if (!deleted) {
        throw new AppError('Suppression not found', 404, ERROR_CODES.NOT_FOUND);
      }
      successResponse(res, { deleted: true });
    } catch (error: unknown) {
      logger.warn('Delete advisor suppression error:', error);
      next(error);
    }
  }
);

export { router as advisorRouter };
