import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const router = Router();

/**
 * POST /api/webhooks/messaging/:provider
 *
 * Future integration for webhook providers (e.g. SendGrid, Mailgun) for delivery updates.
 * Expects raw request body for signature verification.
 */
router.post('/:provider', (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError('Webhook requires raw request body', 400, ERROR_CODES.INVALID_INPUT);
    }

    // Stub response for Phase 1
    res.status(501).json({
      error: ERROR_CODES.NOT_IMPLEMENTED,
      message: 'Provider webhook integrations not implemented yet',
      statusCode: 501,
    });
  } catch (error) {
    next(error);
  }
});

export { router as messagingWebhookRouter };
