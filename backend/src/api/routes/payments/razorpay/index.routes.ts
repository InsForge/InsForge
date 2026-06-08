import { Router, type Response, type NextFunction } from 'express';
import { verifyAdmin, verifyUser, type AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { RazorpaySyncService } from '@/services/payments/razorpay/sync.service.js';
import { RazorpayOrderService } from '@/services/payments/razorpay/order.service.js';
import { RazorpaySubscriptionService } from '@/services/payments/razorpay/subscription.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { PaymentTransactionService } from '@/services/payments/transaction.service.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { razorpayCatalogRouter } from './catalog.routes.js';
import { razorpayConfigRouter } from './config.routes.js';
import {
  ERROR_CODES,
  cancelRazorpaySubscriptionBodySchema,
  createRazorpayOrderBodySchema,
  createRazorpaySubscriptionBodySchema,
  listPaymentCustomersQuerySchema,
  listPaymentTransactionsQuerySchema,
  listRazorpaySubscriptionsQuerySchema,
  pauseRazorpaySubscriptionBodySchema,
  razorpaySubscriptionParamsSchema,
  resumeRazorpaySubscriptionBodySchema,
  verifyRazorpayOrderBodySchema,
  verifyRazorpaySubscriptionBodySchema,
} from '@insforge/shared-schemas';

const router = Router();
const environmentRouter = Router({ mergeParams: true });
const configService = RazorpayConfigService.getInstance();
const syncService = RazorpaySyncService.getInstance();
const orderService = RazorpayOrderService.getInstance();
const subscriptionService = RazorpaySubscriptionService.getInstance();
const customerService = PaymentCustomerService.getInstance();
const transactionService = PaymentTransactionService.getInstance();

router.get('/status', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const connections = await configService.getRazorpayStatus();
    successResponse(res, { razorpayConnections: connections });
  } catch (error) {
    next(error);
  }
});

router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keys = await configService.getKeyConfig();
    successResponse(res, { razorpayKeys: keys });
  } catch (error) {
    next(error);
  }
});

router.post('/sync', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await syncService.syncAll('all');
    successResponse(res, result);
  } catch (error) {
    next(error);
  }
});

environmentRouter.post(
  '/orders',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createRazorpayOrderBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay order creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const order = await orderService.createOrder(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, order, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/orders/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpayOrderBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay order verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await orderService.verifyOrderPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createRazorpaySubscriptionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription creation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const subscription = await subscriptionService.createSubscription(
        {
          environment,
          ...body,
        },
        req.user
      );
      successResponse(res, subscription, 201);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyRazorpaySubscriptionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.verifySubscriptionPayment({
        environment,
        ...body,
      });
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/cancel',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      const body = parseZodSchema(cancelRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription cancellation requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.cancelSubscription(
        {
          ...params,
          ...body,
        },
        req.user
      );
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/pause',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(pauseRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription pause requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.pauseSubscription(params, req.user);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.post(
  '/subscriptions/:subscriptionId/resume',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(razorpaySubscriptionParamsSchema, req.params);
      parseZodSchema(resumeRazorpaySubscriptionBodySchema, req.body ?? {});

      if (!req.user) {
        throw new AppError(
          'Razorpay subscription resume requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await subscriptionService.resumeSubscription(params, req.user);
      successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }
);

environmentRouter.use(verifyAdmin);
environmentRouter.use(razorpayConfigRouter);
environmentRouter.use('/catalog', razorpayCatalogRouter);

environmentRouter.get('/customers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const query = parseZodSchema(listPaymentCustomersQuerySchema, req.query);
    const customers = await customerService.listCustomers({ environment, ...query }, 'razorpay');
    successResponse(res, customers);
  } catch (error) {
    next(error);
  }
});

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
        'razorpay'
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
      const query = parseZodSchema(listRazorpaySubscriptionsQuerySchema, req.query);
      const subscriptions = await subscriptionService.listSubscriptions({ environment, ...query });
      successResponse(res, subscriptions);
    } catch (error) {
      next(error);
    }
  }
);

router.use('/:environment', environmentRouter);

export { router as razorpayRouter };
