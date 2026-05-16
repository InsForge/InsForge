import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { AdvisorService } from '@/services/advisor/advisor.service.js';
import { successResponse } from '@/utils/response.js';

const router = Router();
const advisorService = AdvisorService.getInstance();

router.post('/scan', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const scanResult = await advisorService.runScan();
    successResponse(res, scanResult);
  } catch (error: unknown) {
    next(error);
  }
});

export { router as advisorRouter };
