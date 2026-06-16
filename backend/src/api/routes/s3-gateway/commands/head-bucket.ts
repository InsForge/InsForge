import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const exists = await StorageService.getInstance().bucketExists(bucket);
  if (!exists) {
    sendS3Error(res, 'NoSuchBucket', `Bucket ${bucket} does not exist`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  res.status(200).send();
}
