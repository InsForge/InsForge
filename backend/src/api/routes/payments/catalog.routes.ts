import { Router, Response, NextFunction, Request } from 'express';
import { AppError } from '@/utils/errors.js';
import { PaymentService } from '@/services/payments/payment.service.js';
import { successResponse } from '@/utils/response.js';
import { normalizeStripeError } from '@/providers/payments/stripe-errors.js';
import {
  ERROR_CODES,
  createPaymentPriceBodySchema,
  createPaymentProductBodySchema,
  listPaymentPricesQuerySchema,
  paymentEnvironmentParamsSchema,
  paymentPriceParamsSchema,
  paymentProductParamsSchema,
  updatePaymentPriceBodySchema,
  updatePaymentProductBodySchema,
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
    throw new AppError(formatValidationIssues(validation.error), 400, ERROR_CODES.INVALID_INPUT);
  }

  return validation.data.environment;
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const catalog = await paymentService.listCatalog(environment);
    successResponse(res, catalog);
  } catch (error) {
    next(error);
  }
});

router.get('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const products = await paymentService.listProducts({ environment });
    successResponse(res, products);
  } catch (error) {
    next(error);
  }
});

router.get('/products/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const validation = paymentProductParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const product = await paymentService.getProduct(environment, validation.data.productId);
    successResponse(res, product);
  } catch (error) {
    next(error);
  }
});

router.post('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const environment = getEnvironment(req.params);
    const validation = createPaymentProductBodySchema.safeParse(req.body);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const product = await paymentService.createProduct({
      environment,
      ...validation.data,
    });
    successResponse(res, product, 201);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.patch('/products/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paymentProductParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const environment = getEnvironment(req.params);
    const bodyValidation = updatePaymentProductBodySchema.safeParse(req.body);
    if (!bodyValidation.success) {
      throw invalidInputFromZod(bodyValidation.error);
    }

    const product = await paymentService.updateProduct(validation.data.productId, {
      environment,
      ...bodyValidation.data,
    });
    successResponse(res, product);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.delete('/products/:productId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paymentProductParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const environment = getEnvironment(req.params);
    const product = await paymentService.deleteProduct(environment, validation.data.productId);
    successResponse(res, product);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.get('/prices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const queryValidation = listPaymentPricesQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
      throw invalidInputFromZod(queryValidation.error);
    }

    const environment = getEnvironment(req.params);
    const prices = await paymentService.listPrices({
      environment,
      ...queryValidation.data,
    });
    successResponse(res, prices);
  } catch (error) {
    next(error);
  }
});

router.get('/prices/:priceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paymentPriceParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const environment = getEnvironment(req.params);
    const price = await paymentService.getPrice(environment, validation.data.priceId);
    successResponse(res, price);
  } catch (error) {
    next(error);
  }
});

router.post('/prices', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = createPaymentPriceBodySchema.safeParse(req.body);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const environment = getEnvironment(req.params);
    const price = await paymentService.createPrice({
      environment,
      ...validation.data,
    });
    successResponse(res, price, 201);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.patch('/prices/:priceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paymentPriceParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const bodyValidation = updatePaymentPriceBodySchema.safeParse(req.body);
    if (!bodyValidation.success) {
      throw invalidInputFromZod(bodyValidation.error);
    }

    const environment = getEnvironment(req.params);
    const price = await paymentService.updatePrice(validation.data.priceId, {
      environment,
      ...bodyValidation.data,
    });
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.delete('/prices/:priceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paymentPriceParamsSchema.safeParse(req.params);
    if (!validation.success) {
      throw invalidInputFromZod(validation.error);
    }

    const environment = getEnvironment(req.params);
    const price = await paymentService.archivePrice(environment, validation.data.priceId);
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

export { router as catalogRouter };
