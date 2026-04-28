import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '@/api/middlewares/auth.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { StripeKeyValidationError } from '@/providers/payments/stripe.provider.js';
import { successResponse } from '@/utils/response.js';
import {
  listPaymentPricesRequestSchema,
  paymentPriceParamsSchema,
  createPaymentPriceRequestSchema,
  updatePaymentPriceRequestSchema,
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
    const validation = listPaymentPricesRequestSchema.safeParse(req.query);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const prices = await paymentService.listTestPrices(validation.data);
    successResponse(res, prices);
  } catch (error) {
    next(error);
  }
});

router.get('/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = paymentPriceParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const price = await paymentService.getTestPrice(validation.data.priceId);
    successResponse(res, price);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = createPaymentPriceRequestSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const price = await paymentService.createTestPrice(validation.data);
    successResponse(res, price, 201);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.patch('/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const paramsValidation = paymentPriceParamsSchema.safeParse(req.params);
    if (!paramsValidation.success) {
      throw new AppError(
        formatValidationIssues(paramsValidation.error),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const bodyValidation = updatePaymentPriceRequestSchema.safeParse(req.body);
    if (!bodyValidation.success) {
      throw new AppError(
        formatValidationIssues(bodyValidation.error),
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const price = await paymentService.updateTestPrice(
      paramsValidation.data.priceId,
      bodyValidation.data
    );
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

router.delete('/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validation = paymentPriceParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
    }

    const price = await paymentService.archiveTestPrice(validation.data.priceId);
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeConfigError(error));
  }
});

export { router as pricesRouter };
