import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { StripeSyncService } from '@/services/payments/stripe/sync.service.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { normalizeStripeError } from '@/providers/payments/stripe-errors.js';
import { ERROR_CODES, upsertPaymentsConfigBodySchema } from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const configService = StripeConfigService.getInstance();
const syncService = StripeSyncService.getInstance();

router.put('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const body = parseZodSchema(upsertPaymentsConfigBodySchema, req.body);

    await configService.setStripeSecretKey(
      environment,
      body.secretKey,
      async (syncEnvironment, provider) => {
        await syncService.syncPaymentsEnvironmentAfterKeyChange(syncEnvironment, provider);
      }
    );

    const config = await configService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.delete('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const removed = await configService.removeStripeSecretKey(environment);
    if (!removed) {
      throw new AppError('No Stripe key configured', 404, ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND);
    }

    const config = await configService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.post('/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const result = await syncService.syncPayments({ environment });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.post('/webhook', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const connection = await configService.configureManagedStripeWebhook(environment);
    const result = { connection };
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

export { router as stripeConfigRouter };
