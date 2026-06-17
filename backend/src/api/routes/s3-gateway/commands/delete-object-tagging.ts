import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }

  if (!(await svc.getObjectMetadataRow(bucket, key))) {
    throw new S3ProtocolError('NoSuchKey', `The specified key does not exist: ${key}`);
  }

  await svc.deleteObjectTags(bucket, key);
  res.status(204).send();
}
