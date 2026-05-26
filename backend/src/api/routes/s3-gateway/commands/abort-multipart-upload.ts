import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
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
