import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

const BUCKET_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  if (!BUCKET_NAME_RE.test(bucket)) {
    sendS3Error(res, 'InvalidBucketName', `Invalid bucket name ${bucket}`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  const svc = StorageService.getInstance();
  if (await svc.bucketExists(bucket)) {
    sendS3Error(res, 'BucketAlreadyOwnedByYou', `Bucket ${bucket} already exists`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  await svc.createBucket(bucket, false);
  res.status(200).set('Location', `/${bucket}`).send();
}
