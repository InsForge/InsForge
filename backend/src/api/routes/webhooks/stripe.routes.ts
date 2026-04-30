import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { stripeWebhookParamsSchema } from '@insforge/shared-schemas';

const router = Router();
const paymentService = PaymentService.getInstance();

export function normalizeStripeWebhookError(error: unknown) {
  if (error instanceof Error && error.name === 'StripeSignatureVerificationError') {
    return new AppError(error.message, 400, ERROR_CODES.INVALID_INPUT);
  }

  return error;
}

/**
 * Stripe webhook endpoint
 * POST /api/webhooks/stripe/:environment
 *
 * Receives Stripe test/live account events and updates payment runtime projections.
 * Verifies the request using Stripe's signature over the raw request body.
 */
router.post('/:environment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const paramsValidation = stripeWebhookParamsSchema.safeParse(req.params);
    if (!paramsValidation.success) {
      throw new AppError('Invalid Stripe environment', 400, ERROR_CODES.INVALID_INPUT);
    }

    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      throw new AppError('Missing stripe-signature header', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    if (!Buffer.isBuffer(req.body)) {
      throw new AppError(
        'Stripe webhook requires raw request body',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await paymentService.handleStripeWebhook(
      paramsValidation.data.environment,
      req.body,
      signature
    );

    res.status(200).json(result);
  } catch (error) {
    next(normalizeStripeWebhookError(error));
  }
});

export { router as stripeWebhookRouter };
