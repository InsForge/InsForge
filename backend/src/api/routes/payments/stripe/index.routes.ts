import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyAdmin, verifyUser } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { StripeConfigService } from '@/services/payments/stripe/config.service.js';
import { StripeSyncService } from '@/services/payments/stripe/sync.service.js';
import { StripeCheckoutService } from '@/services/payments/stripe/checkout.service.js';
import { StripeCustomerPortalService } from '@/services/payments/stripe/customer-portal.service.js';
import { StripeSubscriptionService } from '@/services/payments/stripe/subscription.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { PaymentTransactionService } from '@/services/payments/transaction.service.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { stripeCatalogRouter } from './catalog.routes.js';
import { stripeConfigRouter } from './config.routes.js';
import { normalizeStripeError } from '@/providers/payments/stripe-errors.js';
import {
  ERROR_CODES,
  createCheckoutSessionBodySchema,
  createCustomerPortalSessionBodySchema,
  listPaymentCustomersQuerySchema,
  listPaymentTransactionsQuerySchema,
  listStripeSubscriptionsQuerySchema,
} from '@insforge/shared-schemas';

const router = Router();
const environmentRouter = Router({ mergeParams: true });
const configService = StripeConfigService.getInstance();
const syncService = StripeSyncService.getInstance();
const checkoutService = StripeCheckoutService.getInstance();
const customerPortalService = StripeCustomerPortalService.getInstance();
const subscriptionService = StripeSubscriptionService.getInstance();
const customerService = PaymentCustomerService.getInstance();
const transactionService = PaymentTransactionService.getInstance();

router.get('/status', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = await configService.getStatus();
    successResponse(res, status);
  } catch (error) {
    next(error);
  }
});

router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await configService.getConfig();
    successResponse(res, config);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.post('/sync', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await syncService.syncPayments({ environment: 'all' });
    successResponse(res, result);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

environmentRouter.post(
  '/checkout-sessions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createCheckoutSessionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Checkout session creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const checkoutSession = await checkoutService.createCheckoutSession(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, checkoutSession, 201);
    } catch (error) {
      next(normalizeStripeError(error));
    }
  }
);

environmentRouter.post(
  '/customer-portal-sessions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createCustomerPortalSessionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Customer portal session creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const customerPortalSession = await customerPortalService.createCustomerPortalSession(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, customerPortalSession, 201);
    } catch (error) {
      next(normalizeStripeError(error));
    }
  }
);

environmentRouter.use(verifyAdmin);
environmentRouter.use(stripeConfigRouter);
environmentRouter.use('/catalog', stripeCatalogRouter);

environmentRouter.get(
  '/transactions',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const query = parseZodSchema(listPaymentTransactionsQuerySchema, req.query);

      const transactions = await transactionService.listTransactions(
        {
          environment,
          ...query,
        },
        'stripe'
      );
      successResponse(res, transactions);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.get(
  '/subscriptions',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const query = parseZodSchema(listStripeSubscriptionsQuerySchema, req.query);

      const subscriptions = await subscriptionService.listSubscriptions({
        environment,
        ...query,
      });
      successResponse(res, subscriptions);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.get('/customers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const query = parseZodSchema(listPaymentCustomersQuerySchema, req.query);

    const customers = await customerService.listCustomers({
      environment,
      ...query,
    });
    successResponse(res, customers);
  } catch (error) {
    next(error);
  }
});

router.use('/:environment', environmentRouter);

export { router as stripeRouter };
