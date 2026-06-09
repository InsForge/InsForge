import { Router, type Response, type NextFunction } from 'express';
import { type AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { RazorpaySyncService } from '@/services/payments/razorpay/sync.service.js';
import {
  ERROR_CODES,
  razorpayEnvironmentParamsSchema,
  upsertRazorpayConfigBodySchema,
} from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const configService = RazorpayConfigService.getInstance();
const syncService = RazorpaySyncService.getInstance();

router.put('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(razorpayEnvironmentParamsSchema, req.params);
    const body = parseZodSchema(upsertRazorpayConfigBodySchema, req.body);

    await configService.setRazorpayKeys(
      environment,
      body.keyId,
      body.keySecret,
      body.webhookSecret,
      async (syncEnvironment, provider) => {
        await syncService.syncEnvironmentAfterKeyChange(syncEnvironment, provider);
      }
    );

    const keys = await configService.getKeyConfig();
    successResponse(res, { razorpayKeys: keys });
  } catch (error) {
    next(error);
  }
});

router.delete('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(razorpayEnvironmentParamsSchema, req.params);
    const removed = await configService.removeRazorpayKeys(environment);
    if (!removed) {
      throw new AppError(
        'No Razorpay keys configured for this environment',
        404,
        ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND
      );
    }
    const keys = await configService.getKeyConfig();
    successResponse(res, { razorpayKeys: keys });
  } catch (error) {
    next(error);
  }
});

router.post('/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(razorpayEnvironmentParamsSchema, req.params);
    const result = await syncService.syncAll(environment);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

router.get('/webhook', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { environment } = parseZodSchema(razorpayEnvironmentParamsSchema, req.params);
    const result = await configService.getWebhookSetup(environment);
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/webhook/regenerate-secret',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { environment } = parseZodSchema(razorpayEnvironmentParamsSchema, req.params);
      const result = await configService.regenerateWebhookSecret(environment);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

export { router as razorpayConfigRouter };
