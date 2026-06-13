import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '@/api/middlewares/auth.js';
import { StripeProductService } from '@/services/payments/stripe/product.service.js';
import { StripePriceService } from '@/services/payments/stripe/price.service.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { normalizeStripeError } from '@/providers/payments/stripe-errors.js';
import {
  createStripePriceBodySchema,
  createStripeProductBodySchema,
  listStripePricesQuerySchema,
  stripePriceParamsSchema,
  stripeProductParamsSchema,
  updateStripePriceBodySchema,
  updateStripeProductBodySchema,
} from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const productService = StripeProductService.getInstance();
const priceService = StripePriceService.getInstance();

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const [products, prices] = await Promise.all([
      productService.listProducts({ environment }),
      priceService.listPrices({ environment }),
    ]);
    const catalog = {
      products: products.products,
      prices: prices.prices,
    };
    successResponse(res, catalog);
  } catch (error) {
    next(error);
  }
});

router.get('/products', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const products = await productService.listProducts({ environment });
    successResponse(res, products);
  } catch (error) {
    next(error);
  }
});

router.get('/products/:productId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const params = parseZodSchema(stripeProductParamsSchema, req.params);

    const product = await productService.getProduct(environment, params.productId);
    successResponse(res, product);
  } catch (error) {
    next(error);
  }
});

router.post('/products', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const body = parseZodSchema(createStripeProductBodySchema, req.body);

    const product = await productService.createProduct({
      environment,
      ...body,
    });
    successResponse(res, product, 201);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.patch(
  '/products/:productId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(stripeProductParamsSchema, req.params);

      const environment = getPaymentEnvironment(req.params);
      const body = parseZodSchema(updateStripeProductBodySchema, req.body);

      const product = await productService.updateProduct(params.productId, {
        environment,
        ...body,
      });
      successResponse(res, product);
    } catch (error) {
      next(normalizeStripeError(error));
    }
  }
);

router.delete(
  '/products/:productId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseZodSchema(stripeProductParamsSchema, req.params);

      const environment = getPaymentEnvironment(req.params);
      const product = await productService.deleteProduct(environment, params.productId);
      successResponse(res, product);
    } catch (error) {
      next(normalizeStripeError(error));
    }
  }
);

router.get('/prices', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = parseZodSchema(listStripePricesQuerySchema, req.query);

    const environment = getPaymentEnvironment(req.params);
    const prices = await priceService.listPrices({
      environment,
      ...query,
    });
    successResponse(res, prices);
  } catch (error) {
    next(error);
  }
});

router.get('/prices/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = parseZodSchema(stripePriceParamsSchema, req.params);

    const environment = getPaymentEnvironment(req.params);
    const price = await priceService.getPrice(environment, params.priceId);
    successResponse(res, price);
  } catch (error) {
    next(error);
  }
});

router.post('/prices', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = parseZodSchema(createStripePriceBodySchema, req.body);

    const environment = getPaymentEnvironment(req.params);
    const price = await priceService.createPrice({
      environment,
      ...body,
    });
    successResponse(res, price, 201);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.patch('/prices/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = parseZodSchema(stripePriceParamsSchema, req.params);

    const body = parseZodSchema(updateStripePriceBodySchema, req.body);

    const environment = getPaymentEnvironment(req.params);
    const price = await priceService.updatePrice(params.priceId, {
      environment,
      ...body,
    });
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

router.delete('/prices/:priceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const params = parseZodSchema(stripePriceParamsSchema, req.params);

    const environment = getPaymentEnvironment(req.params);
    const price = await priceService.archivePrice(environment, params.priceId);
    successResponse(res, price);
  } catch (error) {
    next(normalizeStripeError(error));
  }
});

export { router as stripeCatalogRouter };
