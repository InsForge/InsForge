import { Router, type Response, type NextFunction } from 'express';
import { normalizePaystackError } from '@/providers/payments/paystack-errors.js';
import { type AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import { PaystackConfigService } from '@/services/payments/paystack/config.service.js';
import {
  paystackEnvironmentParamsSchema,
  upsertPaystackConfigBodySchema,
} from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const configService = PaystackConfigService.getInstance();

router.put('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(paystackEnvironmentParamsSchema, req.params);
    const body = parseZodSchema(upsertPaystackConfigBodySchema, req.body);

    // Pass `publicKey` through unchanged: undefined keeps the stored public key,
    // null explicitly clears it — collapsing undefined to null would deactivate
    // a stored public key on secret-only updates.
    await configService.setPaystackKeys(environment, body.secretKey, body.publicKey);

    const keys = await configService.getKeyConfig();
    successResponse(res, { keys });
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

router.delete('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(paystackEnvironmentParamsSchema, req.params);
    await configService.removePaystackKeys(environment);
    const keys = await configService.getKeyConfig();
    successResponse(res, { keys });
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

router.get('/webhook', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(paystackEnvironmentParamsSchema, req.params);
    const result = await configService.getWebhookSetup(environment);
    successResponse(res, result);
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

export { router as paystackConfigRouter };
