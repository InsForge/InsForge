import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NoSuchKey' ||
    e?.Code === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
  const svc = StorageService.getInstance();
  // S3 DeleteObject is idempotent for missing keys. Real provider failures
  // (network, permission, etc.) must propagate so the outer handler maps them
  // to a proper S3 error — otherwise we'd return 204 AND drop the DB row
  // while the object is still in the bucket.
  try {
    await svc.getProvider().deleteObject(bucket, key);
  } catch (err) {
    if (!isNotFound(err)) {
      throw err;
    }
  }
  await svc.deleteObjectRow(bucket, key);
  res.status(204).send();
}
