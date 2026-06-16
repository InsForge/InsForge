import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    sendS3Error(res, 'NoSuchBucket', `Bucket ${bucket} does not exist`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  if (!(await svc.bucketIsEmpty(bucket))) {
    sendS3Error(res, 'BucketNotEmpty', `Bucket ${bucket} is not empty`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  await svc.deleteBucket(bucket);
  res.status(204).send();
}
