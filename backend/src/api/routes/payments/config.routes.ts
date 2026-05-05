import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { StripeKeyValidationError } from '@/providers/payments/stripe.provider.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { successResponse } from '@/utils/response.js';
import {
  paymentEnvironmentParamsSchema,
  upsertPaymentsConfigBodySchema,
} from '@insforge/shared-schemas';

const router = Router();
const paymentService = PaymentService.getInstance();

function formatValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function invalidInputFromZod(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return new AppError(formatValidationIssues(error), 400, ERROR_CODES.INVALID_INPUT);
}

function normalizeStripeConfigError(error: unknown) {
  if (error instanceof StripeKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.INVALID_INPUT);
  }

  return error;
}

function getEnvironment(params: unknown) {
  const environment =
    typeof params === 'object' && params !== null && 'environment' in params
      ? { environment: params.environment }
      : params;
  const validation = paymentEnvironmentParamsSchema.safeParse(environment);
  if (!validation.success) {
    throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
  }

  return validation.data.environment;
}

router.get('/status', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = await paymentService.getStatus();
    successResponse(res, status);
  } catch (error) {
    next(error);
  }
});

router.get('/config', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await paymentService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.put('/:environment/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(normalizeStripeConfigError(error));
  }
});

router.delete(
  '/:environment/config',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const removed = await paymentService.removeStripeSecretKey(environment);
      if (!removed) {
        throw new AppError('No Stripe key configured', 404, ERROR_CODES.NOT_FOUND);
      }

      const config = await paymentService.getConfig();
      successResponse(res, config);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

router.post('/sync', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await paymentService.syncPayments({ environment: 'all' });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.post('/:environment/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const result = await paymentService.syncPayments({ environment });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.post(
  '/:environment/webhook',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const result = await paymentService.configureWebhook(environment);
      successResponse(res, result);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

export { router as configRouter };
