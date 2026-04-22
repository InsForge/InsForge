import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    sendS3Error(res, 'NoSuchBucket', 'Bucket does not exist', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  const meta = await svc.getObjectMetadataRow(bucket, key);
  if (!meta) {
    sendS3Error(res, 'NoSuchKey', 'Object does not exist', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  res
    .status(200)
    .set('Content-Length', String(meta.size))
    .set('Content-Type', meta.mimeType ?? 'application/octet-stream')
    .set('ETag', `"${meta.etag ?? ''}"`)
    .set('Last-Modified', meta.uploadedAt.toUTCString())
    .set('Accept-Ranges', 'bytes')
    .send();
}
