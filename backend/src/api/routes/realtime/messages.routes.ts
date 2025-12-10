import { Router, Response, NextFunction } from 'express';
import { verifyAdmin, AuthRequest } from '@/api/middlewares/auth.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { listMessagesRequestSchema, messageStatsRequestSchema } from '@insforge/shared-schemas';

const router = Router();
const messageService = RealtimeMessageService.getInstance();

// List messages
router.get('/', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listMessagesRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const messages = await messageService.list(validation.data);
    successResponse(res, messages);
  } catch (error) {
    next(error);
  }
});

// Get message statistics
router.get('/stats', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = messageStatsRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const stats = await messageService.getStats(validation.data);
    successResponse(res, stats);
  } catch (error) {
    next(error);
  }
});

export { router as messagesRouter };
