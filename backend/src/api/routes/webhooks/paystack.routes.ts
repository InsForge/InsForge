import { Router, type Request, type Response, type NextFunction } from 'express';
import { parseZodSchema } from '@/utils/zod.js';
import { AppError } from '@/utils/errors.js';
import { normalizePaystackError } from '@/providers/payments/paystack-errors.js';
import { PaystackWebhookService } from '@/services/payments/paystack/webhook.service.js';
import { ERROR_CODES, paystackWebhookParamsSchema } from '@insforge/shared-schemas';

const router = Router();
const webhookService = PaystackWebhookService.getInstance();

router.post('/:environment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(paystackWebhookParamsSchema, req.params);

    const signature = req.headers['x-paystack-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new AppError('Missing X-Paystack-Signature header', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const rawBodyBuffer = req.body;
    if (!Buffer.isBuffer(rawBodyBuffer)) {
      throw new AppError('Missing raw Paystack webhook body', 400, ERROR_CODES.INVALID_INPUT);
    }

    const result = await webhookService.handlePaystackWebhook(
      environment,
      rawBodyBuffer,
      signature
    );
    res.status(200).json(result);
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

export { router as paystackWebhookRouter };
