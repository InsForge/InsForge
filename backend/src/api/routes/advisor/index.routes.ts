import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { AdvisorService } from '@/services/advisor/advisor.service.js';
import type { AdvisorCategory, AdvisorIssuesQuery, AdvisorSeverity } from '@/lib/advisor/types.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const advisorService = AdvisorService.getInstance();
const advisorCategories = new Set<AdvisorCategory>(['security', 'performance', 'health']);
const advisorSeverities = new Set<AdvisorSeverity>(['critical', 'warning', 'info']);
const DEFAULT_ISSUE_LIMIT = 50;
const MAX_ISSUE_LIMIT = 100;

function parseSingleQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function parseIssueListQuery(req: AuthRequest): AdvisorIssuesQuery {
  const category = parseSingleQueryValue(req.query.category);
  const severity = parseSingleQueryValue(req.query.severity);
  const limitValue = parseSingleQueryValue(req.query.limit);
  const offsetValue = parseSingleQueryValue(req.query.offset);
  const limit = limitValue ? Number.parseInt(limitValue, 10) : DEFAULT_ISSUE_LIMIT;
  const offset = offsetValue ? Number.parseInt(offsetValue, 10) : 0;

  if (category && !advisorCategories.has(category as AdvisorCategory)) {
    throw new AppError('Invalid advisor category', 400, ERROR_CODES.INVALID_INPUT);
  }
  if (severity && !advisorSeverities.has(severity as AdvisorSeverity)) {
    throw new AppError('Invalid advisor severity', 400, ERROR_CODES.INVALID_INPUT);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ISSUE_LIMIT) {
    throw new AppError('Invalid advisor issue limit', 400, ERROR_CODES.INVALID_INPUT);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError('Invalid advisor issue offset', 400, ERROR_CODES.INVALID_INPUT);
  }

  return {
    category: category as AdvisorCategory | undefined,
    severity: severity as AdvisorSeverity | undefined,
    limit,
    offset,
  };
}

router.get('/latest', verifyAdmin, (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    successResponse(res, advisorService.getLatestScan());
  } catch (error: unknown) {
    next(error);
  }
});

router.get('/issues', verifyAdmin, (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    successResponse(res, advisorService.listIssues(parseIssueListQuery(req)));
  } catch (error: unknown) {
    next(error);
  }
});

router.post('/scan', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scanResult = await advisorService.runScan();
    successResponse(res, scanResult);
  } catch (error: unknown) {
    next(error);
  }
});

export { router as advisorRouter };
