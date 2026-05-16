import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';

export const advisorRouter = Router();

advisorRouter.post('/scan', verifyAdmin, (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    successResponse(res, {
      status: 'not_implemented',
      message: 'Advisor scan endpoint is registered. Scan logic is not implemented yet.',
    });
  } catch (error: unknown) {
    next(error);
  }
});
