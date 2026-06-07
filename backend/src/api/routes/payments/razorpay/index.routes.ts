import { Router, type Response, type NextFunction } from 'express';
import { verifyAdmin, verifyUser, type AuthRequest } from '@/api/middlewares/auth.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import { RazorpayConfigService } from '@/services/payments/razorpay/config.service.js';
import { RazorpaySyncService } from '@/services/payments/razorpay/sync.service.js';
import { RazorpayCatalogService } from '@/services/payments/razorpay/catalog.service.js';
import { RazorpaySubscriptionService } from '@/services/payments/razorpay/subscription.service.js';
import { RazorpayPaymentActivityService } from '@/services/payments/razorpay/payment-activity.service.js';
import { RazorpayCheckoutService } from '@/services/payments/razorpay/checkout.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { razorpayConfigRouter } from './config.routes.js';
import {
  listPaymentCustomersQuerySchema,
  listPaymentActivityQuerySchema,
  listRazorpaySubscriptionsQuerySchema,
  createRazorpayOrderBodySchema,
  createRazorpaySubscriptionBodySchema,
  ERROR_CODES,
} from '@insforge/shared-schemas';

const router = Router();
const environmentRouter = Router({ mergeParams: true });
const configService = RazorpayConfigService.getInstance();
const syncService = RazorpaySyncService.getInstance();
const catalogService = RazorpayCatalogService.getInstance();
const subscriptionService = RazorpaySubscriptionService.getInstance();
const paymentActivityService = RazorpayPaymentActivityService.getInstance();
const checkoutService = RazorpayCheckoutService.getInstance();
const customerService = PaymentCustomerService.getInstance();

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

// ---------------------------------------------------------------------------
// Runtime: POST /orders  (one-time payment)
// Requires a valid user token — the developer's server-side SDK calls this on
// behalf of the end-user who clicked "Buy".
// ---------------------------------------------------------------------------
environmentRouter.post(
  '/orders',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createRazorpayOrderBodySchema, req.body);

      const result = await checkoutService.createOrder({ environment, ...body });
      successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Runtime: POST /subscriptions  (recurring billing)
// Requires a valid user token.
// ---------------------------------------------------------------------------
environmentRouter.post(
  '/subscriptions',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(createRazorpaySubscriptionBodySchema, req.body);

      const result = await checkoutService.createSubscription({ environment, ...body });
      successResponse(res, result, 201);
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Admin-only routes
// ---------------------------------------------------------------------------
environmentRouter.use(verifyAdmin);
environmentRouter.use(razorpayConfigRouter);

environmentRouter.get('/catalog', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const catalog = await catalogService.listCatalog(environment);
    successResponse(res, catalog);
  } catch (error) {
    next(error);
  }
});

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
  '/payment-activity',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const query = parseZodSchema(listPaymentActivityQuerySchema, req.query);
      const paymentActivity = await paymentActivityService.listPaymentActivity({
        environment,
        ...query,
      });
      successResponse(res, paymentActivity);
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
