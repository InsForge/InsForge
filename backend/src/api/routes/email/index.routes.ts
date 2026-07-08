import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { EmailService } from '@/services/email/email.service.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, sendRawEmailRequestSchema } from '@insforge/shared-schemas';
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
      // Anonymous clients (anon key, role 'anon') must not be able to send
      // arbitrary emails. Authenticated users and admin API keys are allowed;
      // an admin API key leaves req.user undefined, so only 'anon' is blocked.
      if (req.user?.role === 'anon') {
        throw new AppError(
          'Sending emails requires an authenticated user',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const validation = sendRawEmailRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(JSON.stringify(validation.error.issues), 400, ERROR_CODES.INVALID_INPUT);
      }

      const result = await emailService.sendRaw(validation.data);

      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

export const emailRouter = router;
