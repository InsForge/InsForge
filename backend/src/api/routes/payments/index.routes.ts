import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { StripeKeyValidationError } from '@/providers/payments/stripe.provider.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { successResponse } from '@/utils/response.js';
import { catalogRouter } from './catalog.routes.js';
import { configRouter } from './config.routes.js';
import {
  createCheckoutSessionBodySchema,
  createCustomerPortalSessionBodySchema,
  listPaymentCustomersQuerySchema,
  listPaymentHistoryQuerySchema,
  listSubscriptionsQuerySchema,
  paymentEnvironmentParamsSchema,
} from '@insforge/shared-schemas';

const router = Router();
const environmentRouter = Router({ mergeParams: true });
const paymentService = PaymentService.getInstance();

function formatValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function invalidInputFromZod(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
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
    throw invalidInputFromZod(validation.error);
  }

  return validation.data.environment;
}

router.get('/status', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = await paymentService.getStatus();
    successResponse(res, status);
  } catch (error) {
    next(error);
  }
});

router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await paymentService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.post('/sync', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await paymentService.syncPayments({ environment: 'all' });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

environmentRouter.post(
  '/checkout-sessions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = createCheckoutSessionBodySchema.safeParse(req.body);
      if (!validation.success) {
        throw invalidInputFromZod(validation.error);
      }

      if (!req.user) {
        throw new AppError(
          'Checkout session creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const checkoutSession = await paymentService.createCheckoutSession(
        {
          environment,
          ...validation.data,
        },
        req.user
      );
      successResponse(res, checkoutSession, 201);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

environmentRouter.post(
  '/customer-portal-sessions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = createCustomerPortalSessionBodySchema.safeParse(req.body);
      if (!validation.success) {
        throw invalidInputFromZod(validation.error);
      }

      if (!req.user) {
        throw new AppError(
          'Customer portal session creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const customerPortalSession = await paymentService.createCustomerPortalSession(
        {
          environment,
          ...validation.data,
        },
        req.user
      );
      successResponse(res, customerPortalSession, 201);
    } catch (error) {
      next(normalizeStripeConfigError(error));
    }
  }
);

environmentRouter.use(verifyAdmin);
environmentRouter.use(configRouter);
environmentRouter.use('/catalog', catalogRouter);

environmentRouter.get(
  '/payment-history',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = listPaymentHistoryQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw invalidInputFromZod(validation.error);
      }

      const paymentHistory = await paymentService.listPaymentHistory({
        environment,
        ...validation.data,
      });
      successResponse(res, paymentHistory);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.get(
  '/subscriptions',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getEnvironment(req.params);
      const validation = listSubscriptionsQuerySchema.safeParse(req.query);
      if (!validation.success) {
        throw invalidInputFromZod(validation.error);
      }

      const subscriptions = await paymentService.listSubscriptions({
        environment,
        ...validation.data,
      });
      successResponse(res, subscriptions);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.get('/customers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const validation = listPaymentCustomersQuerySchema.safeParse(req.query);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const customers = await paymentService.listCustomers({
      environment,
      ...validation.data,
    });
    successResponse(res, customers);
  } catch (error) {
    next(error);
  }
});

router.use('/:environment', environmentRouter);

export { router as paymentsRouter };
