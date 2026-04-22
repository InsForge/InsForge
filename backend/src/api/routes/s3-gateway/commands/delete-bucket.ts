import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
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
