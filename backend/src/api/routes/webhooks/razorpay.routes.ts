import { Router, type Request, type Response, type NextFunction } from 'express';
import { parseZodSchema } from '@/utils/zod.js';
import { AppError } from '@/utils/errors.js';
import { RazorpayWebhookService } from '@/services/payments/razorpay/webhook.service.js';
import { ERROR_CODES, razorpayWebhookParamsSchema } from '@insforge/shared-schemas';

const router = Router();
const webhookService = RazorpayWebhookService.getInstance();

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

router.post('/:environment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(razorpayWebhookParamsSchema, req.params);

    const signature = req.headers['x-razorpay-signature'];
    if (!signature || typeof signature !== 'string') {
      throw new AppError('Missing X-Razorpay-Signature header', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }

    const rawBodyBuffer = req.body;
    if (!Buffer.isBuffer(rawBodyBuffer)) {
      throw new AppError('Missing raw Razorpay webhook body', 400, ERROR_CODES.INVALID_INPUT);
    }

    const headerEventId = req.headers['x-razorpay-event-id'];
    const result = await webhookService.handleRazorpayWebhook(
      environment,
      rawBodyBuffer,
      signature,
      typeof headerEventId === 'string' ? headerEventId : undefined,
      {
        contentLength: getHeaderValue(req.headers['content-length']),
        contentType: getHeaderValue(req.headers['content-type']),
        host: getHeaderValue(req.headers.host),
        userAgent: getHeaderValue(req.headers['user-agent']),
      }
    );
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export { router as razorpayWebhookRouter };
