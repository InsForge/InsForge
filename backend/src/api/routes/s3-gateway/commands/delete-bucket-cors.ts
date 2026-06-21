import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }

  await svc.deleteBucketCorsRules(bucket);
  res.status(204).send();
}
