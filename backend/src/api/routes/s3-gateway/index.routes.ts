import { Router, Request, Response } from 'express';
import {
  s3Sigv4Middleware,
  S3AuthenticatedRequest,
} from '@/api/middlewares/s3-sigv4.js';
import { dispatchOp, parseBucketAndKey, S3Op } from './dispatch.js';
import { sendS3Error } from './errors.js';
import { StorageService } from '@/services/storage/storage.service.js';
import logger from '@/utils/logger.js';
import * as listBuckets from './commands/list-buckets.js';
import * as headBucket from './commands/head-bucket.js';
import * as createBucket from './commands/create-bucket.js';
import * as deleteBucket from './commands/delete-bucket.js';
import * as listObjectsV2 from './commands/list-objects-v2.js';

export const s3GatewayRouter: Router = Router();

// 1) Refuse at mount if backend isn't S3-compatible.
s3GatewayRouter.use((req: Request, res: Response, next) => {
  if (!StorageService.getInstance().isS3Provider()) {
    sendS3Error(
      res,
      'NotImplemented',
      'S3 protocol requires an S3 storage backend. Set AWS_S3_BUCKET.',
      { resource: req.path }
    );
    return;
  }
  next();
});

// 2) SigV4 authentication.
s3GatewayRouter.use((req, res, next) => {
  void s3Sigv4Middleware(req, res, next);
});

// 3) Dispatch to the operation handler.
s3GatewayRouter.use(async (req: Request, res: Response) => {
  const query: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string' || Array.isArray(v) || v === undefined) query[k] = v as string | string[] | undefined;
  }
  const op: S3Op | null = dispatchOp({
    method: req.method,
    path: req.path,
    query,
    headers: req.headers,
  });
  if (!op) {
    sendS3Error(res, 'MethodNotAllowed', `Method ${req.method} not allowed`, {
      resource: req.path,
      requestId: (req as S3AuthenticatedRequest).s3Auth?.requestId,
    });
    return;
  }
  const { bucket, key } = parseBucketAndKey(req.path);
  (req as Request & { s3Op?: S3Op; s3Bucket?: string | null; s3Key?: string | null }).s3Op = op;
  (req as Request & { s3Bucket?: string | null }).s3Bucket = bucket;
  (req as Request & { s3Key?: string | null }).s3Key = key;
  logger.debug('S3 gateway dispatch', { op, bucket, key });

  const authed = req as S3AuthenticatedRequest;
  try {
    switch (op) {
      case 'ListBuckets':
        await listBuckets.handle(authed, res);
        return;
      case 'HeadBucket':
        await headBucket.handle(authed, res);
        return;
      case 'CreateBucket':
        await createBucket.handle(authed, res);
        return;
      case 'DeleteBucket':
        await deleteBucket.handle(authed, res);
        return;
      case 'ListObjectsV2':
        await listObjectsV2.handle(authed, res);
        return;
      default:
        sendS3Error(res, 'NotImplemented', `Operation ${op} not yet implemented`, {
          resource: req.path,
          requestId: authed.s3Auth?.requestId,
        });
        return;
    }
  } catch (err) {
    logger.error('S3 gateway handler error', { op, err });
    if (res.headersSent) return;
    sendS3Error(
      res,
      'InternalError',
      err instanceof Error ? err.message : 'Internal error',
      { resource: req.path, requestId: authed.s3Auth?.requestId }
    );
  }
});
