import { Router, Request, Response } from 'express';
import { s3Sigv4Middleware, S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';
import { dispatchOp, parseBucketAndKey, S3Op } from './dispatch.js';
import { sendS3Error, S3ProtocolError } from './errors.js';
import { StorageService } from '@/services/storage/storage.service.js';
import logger from '@/utils/logger.js';
import * as listBuckets from './commands/list-buckets.js';
import * as headBucket from './commands/head-bucket.js';
import * as createBucket from './commands/create-bucket.js';
import * as deleteBucket from './commands/delete-bucket.js';
import * as listObjectsV2 from './commands/list-objects-v2.js';
import * as headObject from './commands/head-object.js';
import * as getObject from './commands/get-object.js';
import * as putObject from './commands/put-object.js';
import * as deleteObject from './commands/delete-object.js';
import * as deleteObjects from './commands/delete-objects.js';
import * as copyObject from './commands/copy-object.js';
import * as createMultipartUpload from './commands/create-multipart-upload.js';
import * as uploadPart from './commands/upload-part.js';
import * as completeMultipartUpload from './commands/complete-multipart-upload.js';
import * as abortMultipartUpload from './commands/abort-multipart-upload.js';
import * as listParts from './commands/list-parts.js';
import * as stubs from './commands/stubs.js';

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

// 2) SigV4 authentication. Express 4 doesn't auto-forward rejected promises
// from async middleware — chain .catch(next) so DB/service errors inside
// the middleware hit the error handler instead of hanging the request.
s3GatewayRouter.use((req, res, next) => {
  s3Sigv4Middleware(req, res, next).catch(next);
});

// 3) Dispatch to the operation handler.
s3GatewayRouter.use(async (req: Request, res: Response) => {
  const query: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string' || Array.isArray(v) || v === undefined) {
      query[k] = v as string | string[] | undefined;
    }
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
      case 'HeadObject':
        await headObject.handle(authed, res);
        return;
      case 'GetObject':
        await getObject.handle(authed, res);
        return;
      case 'PutObject':
        await putObject.handle(authed, res);
        return;
      case 'DeleteObject':
        await deleteObject.handle(authed, res);
        return;
      case 'DeleteObjects':
        await deleteObjects.handle(authed, res);
        return;
      case 'CopyObject':
        await copyObject.handle(authed, res);
        return;
      case 'CreateMultipartUpload':
        await createMultipartUpload.handle(authed, res);
        return;
      case 'UploadPart':
        await uploadPart.handle(authed, res);
        return;
      case 'CompleteMultipartUpload':
        await completeMultipartUpload.handle(authed, res);
        return;
      case 'AbortMultipartUpload':
        await abortMultipartUpload.handle(authed, res);
        return;
      case 'ListParts':
        await listParts.handle(authed, res);
        return;
      case 'GetBucketLocation':
        await stubs.getBucketLocation(authed, res);
        return;
      case 'GetBucketVersioning':
        await stubs.getBucketVersioning(authed, res);
        return;
      default:
        sendS3Error(res, 'NotImplemented', `Operation ${op} not yet implemented`, {
          resource: req.path,
          requestId: authed.s3Auth?.requestId,
        });
        return;
    }
  } catch (err) {
    if (res.headersSent) {
      logger.error('S3 gateway handler error after headers sent', { op, err });
      return;
    }
    // Typed protocol error — use its S3 code/status directly.
    if (err instanceof S3ProtocolError) {
      sendS3Error(res, err.code, err.message, {
        resource: req.path,
        requestId: authed.s3Auth?.requestId,
      });
      return;
    }
    // Chunk signature failures bubble out of the streaming parser as plain
    // Error with 'SignatureDoesNotMatch' in the message — translate to the
    // S3 auth error rather than a generic 500.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('SignatureDoesNotMatch')) {
      logger.warn('S3 gateway chunk signature failure', { op, err });
      sendS3Error(res, 'SignatureDoesNotMatch', msg, {
        resource: req.path,
        requestId: authed.s3Auth?.requestId,
      });
      return;
    }
    logger.error('S3 gateway handler error', { op, err });
    sendS3Error(res, 'InternalError', msg, {
      resource: req.path,
      requestId: authed.s3Auth?.requestId,
    });
  }
});
