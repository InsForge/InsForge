import { Router, Response, NextFunction } from 'express';
import { getUserContextFromReq, AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { VectorSearchService } from '@/services/database/vector-search.service.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import { vectorSearchRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const vectorSearchService = VectorSearchService.getInstance();

/**
 * POST /api/vector/search
 * Perform nearest-neighbor search against a pgvector column.
 */
router.post('/search', verifyUser, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validationResult = vectorSearchRequestSchema.safeParse(req.body);
    if (!validationResult.success) {
      throw new AppError(
        validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await vectorSearchService.search(
      validationResult.data,
      getUserContextFromReq(req)
    );
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

export { router as vectorRouter };
