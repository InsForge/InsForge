import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { EmailService } from '@/services/email/email.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { sendRawEmailRequestSchema } from '@insforge/shared-schemas';
import { successResponse } from '@/utils/response.js';

const router = Router();
const emailService = EmailService.getInstance();

/**
 * POST /api/email/send-raw
 * Send a raw/custom email with explicit to, subject, and body
 */
router.post(
  '/send-raw',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = sendRawEmailRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(JSON.stringify(validation.error.issues), 400, ERROR_CODES.INVALID_INPUT);
      }

      await emailService.sendRaw(validation.data);

      successResponse(res, { success: true });
    } catch (error) {
      next(error);
    }
  }
);

export const emailRouter = router;
