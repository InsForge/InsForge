import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/errors.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { successResponse } from '@/utils/response.js';
import { normalizeStripeError } from '@/providers/payments/stripe-errors.js';
import {
  ERROR_CODES,
  paymentEnvironmentParamsSchema,
  upsertPaymentsConfigBodySchema,
} from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const paymentService = PaymentService.getInstance();

function formatValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function invalidInputFromZod(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return new AppError(formatValidationIssues(error), 400, ERROR_CODES.INVALID_INPUT);
}

function getEnvironment(params: unknown) {
  const environment =
    typeof params === 'object' && params !== null && 'environment' in params
      ? { environment: params.environment }
      : params;
  const validation = paymentEnvironmentParamsSchema.safeParse(environment);
  if (!validation.success) {
    throw invalidInputFromZod(validation.error);
  }

  return validation.data.environment;
}

router.put('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const validation = upsertPaymentsConfigBodySchema.safeParse(req.body);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    await paymentService.setStripeSecretKey(environment, validation.data.secretKey);

    const config = await paymentService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.delete('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const removed = await paymentService.removeStripeSecretKey(environment);
    if (!removed) {
      throw new AppError('No Stripe key configured', 404, ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND);
    }

    const config = await paymentService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const result = await paymentService.syncPayments({ environment });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const result = await paymentService.configureWebhook(environment);
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

export { router as configRouter };
