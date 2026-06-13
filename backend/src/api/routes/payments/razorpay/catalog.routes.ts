import { Router, type Response, type NextFunction } from 'express';
import { type AuthRequest } from '@/api/middlewares/auth.js';
import { RazorpayCatalogService } from '@/services/payments/razorpay/catalog.service.js';
import { getPaymentEnvironment } from '@/services/payments/helpers.js';
import { successResponse } from '@/utils/response.js';
import { parseZodSchema } from '@/utils/zod.js';
import {
  createRazorpayItemBodySchema,
  createRazorpayPlanBodySchema,
  razorpayItemParamsSchema,
  updateRazorpayItemBodySchema,
} from '@insforge/shared-schemas';

const router = Router({ mergeParams: true });
const catalogService = RazorpayCatalogService.getInstance();

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const catalog = await catalogService.listCatalog(environment);
    successResponse(res, catalog);
  } catch (error) {
    next(error);
  }
});

router.post('/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const body = parseZodSchema(createRazorpayItemBodySchema, req.body);
    const item = await catalogService.createItem({
      environment,
      ...body,
    });
    successResponse(res, item, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const params = parseZodSchema(razorpayItemParamsSchema, req.params);
    const body = parseZodSchema(updateRazorpayItemBodySchema, req.body);
    const item = await catalogService.updateItem(params.itemId, {
      environment,
      ...body,
    });
    successResponse(res, item);
  } catch (error) {
    next(error);
  }
});

router.post('/plans', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const environment = getPaymentEnvironment(req.params);
    const body = parseZodSchema(createRazorpayPlanBodySchema, req.body);
    const plan = await catalogService.createPlan({
      environment,
      ...body,
    });
    successResponse(res, plan, 201);
  } catch (error) {
    next(error);
  }
});

export { router as razorpayCatalogRouter };
