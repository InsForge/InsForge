import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { VectorService, type VectorActor } from '@/services/vectors/vector.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  createCollectionRequestSchema,
  vectorUpsertRequestSchema,
  vectorQueryRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const vectorService = VectorService.getInstance();

// Reachable by the project API key (project-global store) and app end users
// (own, RLS-scoped collections and items).
router.use(verifyUser);

// API-key callers and the admin dashboard (project_admin JWT) manage the
// project-global store with full access via the superuser pool (RLS bypassed).
// Only genuine end users operate as their authenticated/anon identity through RLS.
function resolveActor(req: AuthRequest): VectorActor {
  if (req.hasApiKey || req.user?.role === 'project_admin') {
    return { mode: 'admin' };
  }
  if (!req.user) {
    throw new AppError('Authentication required', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
  }
  return { mode: 'user', ctx: req.user };
}

function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      `Validation error: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  return parsed.data;
}

// POST /api/vectors/collections
router.post('/collections', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const input = parseBody(createCollectionRequestSchema, req.body);
    const collection = await vectorService.createCollection(resolveActor(req), input);
    successResponse(res, { collection }, 201);
  } catch (error) {
    next(error);
  }
});

// GET /api/vectors/collections
router.get('/collections', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const collections = await vectorService.listCollections(resolveActor(req));
    successResponse(res, { collections });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/vectors/collections/:name
router.delete('/collections/:name', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deleted = await vectorService.deleteCollection(resolveActor(req), req.params.name);
    if (!deleted) {
      throw new AppError(
        `Collection not found: ${req.params.name}`,
        404,
        ERROR_CODES.VECTOR_COLLECTION_NOT_FOUND
      );
    }
    successResponse(res, { deleted });
  } catch (error) {
    next(error);
  }
});

// POST /api/vectors/collections/:name/upsert
router.post(
  '/collections/:name/upsert',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { items } = parseBody(vectorUpsertRequestSchema, req.body);
      const ids = await vectorService.upsert(resolveActor(req), req.params.name, items);
      successResponse(res, { ids });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/vectors/collections/:name/query
router.post(
  '/collections/:name/query',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const params = parseBody(vectorQueryRequestSchema, req.body);
      const matches = await vectorService.query(resolveActor(req), req.params.name, params);
      successResponse(res, { matches });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/vectors/collections/:name/items/:itemId
router.delete(
  '/collections/:name/items/:itemId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const deleted = await vectorService.deleteItem(
        resolveActor(req),
        req.params.name,
        req.params.itemId
      );
      if (!deleted) {
        throw new AppError(
          `Item not found: ${req.params.itemId}`,
          404,
          ERROR_CODES.VECTOR_ITEM_NOT_FOUND
        );
      }
      successResponse(res, { deleted });
    } catch (error) {
      next(error);
    }
  }
);

export { router as vectorRouter };
