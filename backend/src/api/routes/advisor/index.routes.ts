import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { AdvisorService } from '@/services/advisor/advisor.service.js';
import { successResponse } from '@/utils/response.js';
import logger from '@/utils/logger.js';

export const advisorRouter = Router();
const advisorService = AdvisorService.getInstance();

advisorRouter.post(
  '/scan',
  verifyAdmin,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await advisorService.scan();
      successResponse(res, result);
    } catch (error: unknown) {
      logger.warn('Advisor scan error:', error);
      next(error);
    }
  }
);
