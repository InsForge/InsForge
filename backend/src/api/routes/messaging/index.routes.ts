import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyAdmin, verifyUser } from '@/api/middlewares/auth.js';
import { MessagingQueueService } from '@/services/messaging/queue.service.js';
import { DeadLetterService } from '@/services/messaging/dead-letter.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { DatabaseManager } from '@/infra/database/database.manager.js';

const router = Router();
const queueService = MessagingQueueService.getInstance();
const deadLetterService = DeadLetterService.getInstance();

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
 * Enqueue a new message (Admin / internal only)
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

    const messageId = await queueService.enqueue(validation.data);
    successResponse(res, { messageId, status: 'pending' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/messaging/status/:messageId
 * Get current message status and details
 */
router.get(
  '/status/:messageId',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { messageId } = req.params;
      const pool = DatabaseManager.getInstance().getPool();

      // Check active outbox
      const outboxRes = await pool.query(
        'SELECT status, error_message FROM messaging.outbox WHERE id = $1',
        [messageId]
      );

      if (outboxRes.rows.length > 0) {
        return successResponse(res, {
          messageId,
          status: outboxRes.rows[0].status,
          error: outboxRes.rows[0].error_message || null,
        });
      }

      // Check dead letter queue
      const dlRes = await pool.query(
        'SELECT error_message FROM messaging.dead_letter WHERE id = $1',
        [messageId]
      );

      if (dlRes.rows.length > 0) {
        return successResponse(res, {
          messageId,
          status: 'dead',
          error: dlRes.rows[0].error_message || null,
        });
      }

      throw new AppError('Message not found', 404, ERROR_CODES.NOT_FOUND);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/messaging/dead-letter
 * List dead letter messages (Admin only)
 */
router.get(
  '/dead-letter',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 100);
      const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

      const messages = await deadLetterService.list(limit, offset);
      successResponse(res, messages);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/messaging/dead-letter/:messageId/revive
 * Revive a message from dead letter queue back to outbox (Admin only)
 */
router.post(
  '/dead-letter/:messageId/revive',
  verifyAdmin,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { messageId } = req.params;
      await deadLetterService.revive(messageId);
      successResponse(res, { success: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
