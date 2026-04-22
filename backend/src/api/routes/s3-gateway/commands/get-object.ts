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
  const range = req.headers['range'] as string | undefined;
  try {
    const result = await svc.getProvider().getObjectStream(bucket, key, { range });
    res
      .status(range ? 206 : 200)
      .set('Content-Length', String(result.size))
      .set('Content-Type', result.contentType ?? 'application/octet-stream')
      .set('ETag', `"${result.etag}"`)
      .set('Last-Modified', result.lastModified.toUTCString())
      .set('Accept-Ranges', 'bytes');
    result.body.pipe(res);
  } catch (err: unknown) {
    const name = (err as { name?: string; Code?: string }).name ?? (err as { Code?: string }).Code;
    if (name === 'NoSuchKey' || name === 'NotFound') {
      sendS3Error(res, 'NoSuchKey', 'Object does not exist', {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    throw err;
  }
}
