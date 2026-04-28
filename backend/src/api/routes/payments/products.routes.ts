import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { StripeKeyValidationError } from '@/providers/payments/stripe.provider.js';
import { successResponse } from '@/utils/response.js';
import {
  listPaymentProductsRequestSchema,
  paymentProductParamsSchema,
  createPaymentProductRequestSchema,
  updatePaymentProductRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const paymentService = PaymentService.getInstance();

function formatValidationIssues(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}) {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
}

function normalizeStripeConfigError(error: unknown) {
  if (error instanceof StripeKeyValidationError) {
    return new AppError(error.message, 400, ERROR_CODES.INVALID_INPUT);
  }

  return error;
}

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = listPaymentProductsRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const products = await paymentService.listTestProducts();
    successResponse(res, products);
  } catch (error) {
    next(error);
  }
});

router.get('/:productId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = paymentProductParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const product = await paymentService.getTestProduct(validation.data.productId);
    successResponse(res, product);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createPaymentProductRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const product = await paymentService.createTestProduct(validation.data);
    successResponse(res, product, 201);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.patch('/:productId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const paramsValidation = paymentProductParamsSchema.safeParse(req.params);
    if (!paramsValidation.success) {
      throw new AppError(
        formatValidationIssues(paramsValidation.error),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const bodyValidation = updatePaymentProductRequestSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      throw new AppError(
        formatValidationIssues(bodyValidation.error),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const product = await paymentService.updateTestProduct(
      paramsValidation.data.productId,
      bodyValidation.data
    );
    successResponse(res, product);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.delete('/:productId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = paymentProductParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const product = await paymentService.deleteTestProduct(validation.data.productId);
    successResponse(res, product);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

export { router as productsRouter };
