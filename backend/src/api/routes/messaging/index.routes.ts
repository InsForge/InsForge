import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyAdmin } from '@/api/middlewares/auth.js';
import { MessagingQueueService } from '@/services/messaging/queue.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

/**
 * Express router for administrative messaging queue endpoints.
 */
const router = Router();
const queueService = MessagingQueueService.getInstance();

const sendPayloadSchema = z.object({
  channel: z.enum(['email', 'sms', 'push']),
  to: z.string().min(1),
  subject: z.string().optional(),
  body: z.string().optional(),
  idempotencyKey: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * POST /api/messaging/send
 * Enqueues a raw transactional message for processing. Requires admin authentication.
 *
 * @param req - AuthRequest containing user credentials and body payload
 * @param res - Express Response object
 * @param next - Express NextFunction
 */
router.post('/send', verifyAdmin, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = sendPayloadSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const { id: messageId, status } = await queueService.enqueue(validation.data);
    successResponse(res, { messageId, status }, 202);
  } catch (error) {
    next(error);
  }
});

export default router;
