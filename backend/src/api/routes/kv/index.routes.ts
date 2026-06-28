import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import { KvService, type KvActor } from '@/services/kv/kv.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  kvSetRequestSchema,
  kvIncrRequestSchema,
  kvCasRequestSchema,
  kvExpireRequestSchema,
  kvMgetRequestSchema,
  kvMsetRequestSchema,
} from '@insforge/shared-schemas';

const router = Router();
const kvService = KvService.getInstance();

// The KV store is reachable by the project API key (manages the shared
// project-global store) and by app end users (own, RLS-scoped entries).
router.use(verifyUser);

// API-key callers and the admin dashboard (project_admin JWT) manage the
// project-global store with full access via the superuser pool (RLS bypassed).
// Only genuine end users operate as their authenticated/anon identity through RLS.
function resolveActor(req: AuthRequest): KvActor {
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

// --- bulk ops (registered before the dynamic /entries routes) ---------------

// POST /api/kv/mget
router.post('/mget', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { namespace, keys } = parseBody(kvMgetRequestSchema, req.body);
    const values = await kvService.mget(resolveActor(req), namespace, keys);
    successResponse(res, { values });
  } catch (error) {
    next(error);
  }
});

// POST /api/kv/mset
router.post('/mset', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { namespace, entries, ttl, visibility } = parseBody(kvMsetRequestSchema, req.body);
    const count = await kvService.mset(resolveActor(req), namespace, entries, ttl, visibility);
    successResponse(res, { count });
  } catch (error) {
    next(error);
  }
});

// --- single-key ops ---------------------------------------------------------

// GET /api/kv/entries/:namespace  (list keys)
router.get('/entries/:namespace', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const keys = await kvService.list(resolveActor(req), req.params.namespace);
    successResponse(res, { keys });
  } catch (error) {
    next(error);
  }
});

// GET /api/kv/entries/:namespace/:key/ttl
router.get(
  '/entries/:namespace/:key/ttl',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ttl = await kvService.ttl(resolveActor(req), req.params.namespace, req.params.key);
      successResponse(res, { ttl });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/kv/entries/:namespace/:key
router.get(
  '/entries/:namespace/:key',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const value = await kvService.get(resolveActor(req), req.params.namespace, req.params.key);
      if (value === null) {
        throw new AppError(
          `Key not found: ${req.params.namespace}/${req.params.key}`,
          404,
          ERROR_CODES.KV_NOT_FOUND
        );
      }
      successResponse(res, { value });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/kv/entries/:namespace/:key
router.put(
  '/entries/:namespace/:key',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = parseBody(kvSetRequestSchema, req.body);
      const result = await kvService.set(
        resolveActor(req),
        req.params.namespace,
        req.params.key,
        body
      );
      successResponse(res, result, result.created ? 200 : 409);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/kv/entries/:namespace/:key
router.delete(
  '/entries/:namespace/:key',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const deleted = await kvService.del(resolveActor(req), req.params.namespace, req.params.key);
      successResponse(res, { deleted });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/kv/entries/:namespace/:key/incr
router.post(
  '/entries/:namespace/:key/incr',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { by } = parseBody(kvIncrRequestSchema, req.body);
      const value = await kvService.incrBy(
        resolveActor(req),
        req.params.namespace,
        req.params.key,
        by
      );
      successResponse(res, { value });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/kv/entries/:namespace/:key/decr
router.post(
  '/entries/:namespace/:key/decr',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { by } = parseBody(kvIncrRequestSchema, req.body);
      const value = await kvService.incrBy(
        resolveActor(req),
        req.params.namespace,
        req.params.key,
        -by
      );
      successResponse(res, { value });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/kv/entries/:namespace/:key/cas
router.post(
  '/entries/:namespace/:key/cas',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { expected, next: nextValue } = parseBody(kvCasRequestSchema, req.body);
      const entry = await kvService.cas(
        resolveActor(req),
        req.params.namespace,
        req.params.key,
        expected,
        nextValue
      );
      successResponse(res, { entry });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/kv/entries/:namespace/:key/expire
router.post(
  '/entries/:namespace/:key/expire',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { ttl } = parseBody(kvExpireRequestSchema, req.body);
      const updated = await kvService.expire(
        resolveActor(req),
        req.params.namespace,
        req.params.key,
        ttl
      );
      if (!updated) {
        throw new AppError(
          `Key not found: ${req.params.namespace}/${req.params.key}`,
          404,
          ERROR_CODES.KV_NOT_FOUND
        );
      }
      successResponse(res, { updated });
    } catch (error) {
      next(error);
    }
  }
);

export { router as kvRouter };
