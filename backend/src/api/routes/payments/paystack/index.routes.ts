import { Router, type Response, type NextFunction } from 'express';
import { normalizePaystackError } from '@/providers/payments/paystack-errors.js';
import { verifyAdmin, verifyUser, type AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/utils/errors.js';
import { successResponse } from '@/utils/response.js';
import { PaystackConfigService } from '@/services/payments/paystack/config.service.js';
import { PaystackTransactionService } from '@/services/payments/paystack/transaction.service.js';
import { PaymentCustomerService } from '@/services/payments/payment-customer.service.js';
import { PaymentTransactionService } from '@/services/payments/transaction.service.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { paystackConfigRouter } from './config.routes.js';
import {
  ERROR_CODES,
  initializePaystackTransactionBodySchema,
  listPaymentCustomersQuerySchema,
  listPaymentTransactionsQuerySchema,
  verifyPaystackTransactionBodySchema,
} from '@insforge/shared-schemas';

const router = Router();
const environmentRouter = Router({ mergeParams: true });
const configService = PaystackConfigService.getInstance();
const paystackTransactionService = PaystackTransactionService.getInstance();
const customerService = PaymentCustomerService.getInstance();
const transactionService = PaymentTransactionService.getInstance();

router.get('/status', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const connections = await configService.getPaystackStatus();
    successResponse(res, { paystackConnections: connections });
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

router.get('/config', verifyAdmin, async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keys = await configService.getKeyConfig();
    successResponse(res, { keys });
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

environmentRouter.post(
  '/transactions/initialize',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(initializePaystackTransactionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Paystack transaction initialization requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await paystackTransactionService.initializeTransaction(
        environment,
        body,
        req.user
      );
      successResponse(res, result, 201);
    } catch (error) {
      next(normalizePaystackError(error));
    }
  }
);

environmentRouter.post(
  '/transactions/verify',
  verifyUser,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(verifyPaystackTransactionBodySchema, req.body);

      if (!req.user) {
        throw new AppError(
          'Paystack transaction verification requires a user token',
          401,
          ERROR_CODES.AUTH_INVALID_CREDENTIALS
        );
      }

      const result = await paystackTransactionService.verifyTransaction(
        environment,
        body.reference,
        req.user
      );
      successResponse(res, result);
    } catch (error) {
      next(normalizePaystackError(error));
    }
  }
);

environmentRouter.use(verifyAdmin);
environmentRouter.use(paystackConfigRouter);

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
        'paystack'
      );
      successResponse(res, transactions);
    } catch (error) {
      next(normalizePaystackError(error));
    }
  }
);

environmentRouter.get('/customers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const query = parseZodSchema(listPaymentCustomersQuerySchema, req.query);
    const customers = await customerService.listCustomers({ environment, ...query }, 'paystack');
    successResponse(res, customers);
  } catch (error) {
    next(normalizePaystackError(error));
  }
});

router.use('/:environment', environmentRouter);

export { router as paystackRouter };
