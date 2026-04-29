import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { StripeKeyValidationError } from '@/providers/payments/stripe.provider.js';
import { successResponse } from '@/utils/response.js';
import { pricesRouter } from './prices.routes.js';
import { productsRouter } from './products.routes.js';
import {
  stripeEnvironmentSchema,
  upsertPaymentsConfigRequestSchema,
  createCheckoutSessionRequestSchema,
  listPaymentCatalogRequestSchema,
  listPaymentHistoryRequestSchema,
  listSubscriptionsRequestSchema,
  syncPaymentsRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const paymentService = PaymentService.getInstance();

router.post(
  '/checkout-sessions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = createCheckoutSessionRequestSchema.safeParse(req.body);
      if (!validation.success) {
        throw new AppError(
          validation.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join(', '),
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      if (!req.user) {
        throw new AppError(
          'Checkout session creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const checkoutSession = await paymentService.createCheckoutSession(validation.data, req.user);
      successResponse(res, checkoutSession, 201);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

router.use(verifyAdmin);

function normalizeStripeConfigError(error: unknown) {
  if (error instanceof StripeKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.INVALID_INPUT);
  }

  return error;
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

router.post('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = upsertPaymentsConfigRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    await paymentService.setStripeSecretKey(validation.data.environment, validation.data.secretKey);

    const config = await paymentService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.delete(
  '/config/:environment',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = stripeEnvironmentSchema.safeParse(req.params.environment);
      if (!validation.success) {
        throw new AppError('Invalid Stripe environment', 400, ERROR_CODES.INVALID_INPUT);
      }

      const removed = await paymentService.removeStripeSecretKey(validation.data);
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

router.use('/products', productsRouter);
router.use('/prices', pricesRouter);

router.post('/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = syncPaymentsRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const result = await paymentService.syncPayments(validation.data);
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.post(
  '/webhooks/:environment/configure',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const validation = stripeEnvironmentSchema.safeParse(req.params.environment);
      if (!validation.success) {
        throw new AppError('Invalid Stripe environment', 400, ERROR_CODES.INVALID_INPUT);
      }

      const result = await paymentService.configureWebhook(validation.data);
      successResponse(res, result);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

router.get('/payment-history', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listPaymentHistoryRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const paymentHistory = await paymentService.listPaymentHistory(validation.data);
    successResponse(res, paymentHistory);
  } catch (error) {
    next(error);
  }
});

router.get('/subscriptions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listSubscriptionsRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const subscriptions = await paymentService.listSubscriptions(validation.data);
    successResponse(res, subscriptions);
  } catch (error) {
    next(error);
  }
});

router.get('/catalog', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listPaymentCatalogRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', '),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const catalog = await paymentService.listCatalog(validation.data.environment);
    successResponse(res, catalog);
  } catch (error) {
    next(error);
  }
});

export { router as paymentsRouter };
