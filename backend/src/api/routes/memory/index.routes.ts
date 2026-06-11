import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyApiKey } from '@/api/middlewares/auth.js';
import { MemoryService } from '@/services/memory/memory.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  rememberRequestSchema,
  recallRequestSchema,
  memoryIndexRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const memoryService = MemoryService.getInstance();

// Memory is a platform-managed primitive; callers authenticate with the
// project API key (the CLI / agent), same as other system routes.
router.use(verifyApiKey);

// POST /api/memory/remember
router.post('/remember', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = rememberRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const results = await memoryService.remember(parsed.data);
    successResponse(res, { results });
  } catch (error) {
    next(error);
  }
});

// POST /api/memory/recall
router.post('/recall', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = recallRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const memories = await memoryService.recall(parsed.data);
    successResponse(res, { memories });
  } catch (error) {
    next(error);
  }
});

// POST /api/memory/index  (cheap title-only listing — the always-load tier)
router.post('/index', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = memoryIndexRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const entries = await memoryService.index(parsed.data.scope);
    successResponse(res, { entries });
  } catch (error) {
    next(error);
  }
});

export { router as memoryRouter };
