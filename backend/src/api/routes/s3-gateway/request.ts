import type { S3Op } from './dispatch.js';
import { S3ProtocolError } from './errors.js';
import type { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

/**
 * A SigV4-authenticated request after the gateway dispatch middleware has
 * resolved the operation and parsed bucket/key from the path. `s3Bucket` and
 * `s3Key` are null for operations that don't address them (ListBuckets has
 * neither; bucket-level ops have no key), so command handlers read them through
 * the accessors below rather than asserting non-null at each call site.
 */
export interface S3GatewayRequest extends S3AuthenticatedRequest {
  s3Op: S3Op;
  s3Bucket: string | null;
  s3Key: string | null;
}

/** The target bucket for a bucket/object operation. */
export function getS3Bucket(req: S3GatewayRequest): string {
  if (req.s3Bucket === null) {
    throw new S3ProtocolError('InvalidRequest', 'Missing bucket in request path');
  }
  return req.s3Bucket;
}

/** The target object key for an object operation. */
export function getS3Key(req: S3GatewayRequest): string {
  if (req.s3Key === null) {
    throw new S3ProtocolError('InvalidRequest', 'Missing object key in request path');
  }
  return req.s3Key;
}
