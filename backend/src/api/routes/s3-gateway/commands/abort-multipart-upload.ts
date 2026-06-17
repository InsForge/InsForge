import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
  const uploadIdRaw = req.query.uploadId;
  const uploadId = typeof uploadIdRaw === 'string' ? uploadIdRaw : '';
  if (!uploadId) {
    sendS3Error(res, 'InvalidRequest', 'Missing uploadId', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  await StorageService.getInstance().getProvider().abortMultipartUpload(bucket, key, uploadId);
  res.status(204).send();
}
