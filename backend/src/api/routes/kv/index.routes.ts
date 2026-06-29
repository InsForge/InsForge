import { Router, Response, NextFunction } from 'express';
import { AuthRequest, verifyUser } from '@/api/middlewares/auth.js';
import {
  resolveStoreActor as resolveActor,
  parseBody,
  parseParam,
} from '@/api/middlewares/store-actor.js';
import { KvService } from '@/services/kv/kv.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  kvNamespaceSchema,
  kvKeySchema,
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

const ns = (req: AuthRequest) => parseParam(kvNamespaceSchema, req.params.namespace, 'namespace');
const key = (req: AuthRequest) => parseParam(kvKeySchema, req.params.key, 'key');

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
    const keys = await kvService.list(resolveActor(req), ns(req));
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
      const ttl = await kvService.ttl(resolveActor(req), ns(req), key(req));
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
      const namespace = ns(req);
      const k = key(req);
      const value = await kvService.get(resolveActor(req), namespace, k);
      if (value === null) {
        throw new AppError(`Key not found: ${namespace}/${k}`, 404, ERROR_CODES.KV_NOT_FOUND);
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
      // Always 200: a setnx conflict (created=false, entry=null) is a normal
      // outcome the caller inspects via `created`, not an HTTP error.
      const result = await kvService.set(resolveActor(req), ns(req), key(req), body);
      successResponse(res, result);
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
      const deleted = await kvService.del(resolveActor(req), ns(req), key(req));
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
      const value = await kvService.incrBy(resolveActor(req), ns(req), key(req), by);
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
      // `by` is validated positive; negate it here for the decrement.
      const { by } = parseBody(kvIncrRequestSchema, req.body);
      const value = await kvService.incrBy(resolveActor(req), ns(req), key(req), -by);
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
      const entry = await kvService.cas(resolveActor(req), ns(req), key(req), expected, nextValue);
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
      const namespace = ns(req);
      const k = key(req);
      const updated = await kvService.expire(resolveActor(req), namespace, k, ttl);
      if (!updated) {
        throw new AppError(`Key not found: ${namespace}/${k}`, 404, ERROR_CODES.KV_NOT_FOUND);
      }
      successResponse(res, { updated });
    } catch (error) {
      next(error);
    }
  }
);

export { router as kvRouter };
