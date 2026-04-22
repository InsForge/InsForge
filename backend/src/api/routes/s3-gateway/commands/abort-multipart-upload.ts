import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const uploadId = req.query.uploadId as string;
  await StorageService.getInstance().getProvider().abortMultipartUpload(bucket, key, uploadId);
  res.status(204).send();
}
