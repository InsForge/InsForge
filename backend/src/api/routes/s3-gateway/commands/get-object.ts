import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    sendS3Error(res, 'NoSuchBucket', 'Bucket does not exist', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  // Branch DB is the source of truth for "does this object exist in this
  // branch?". Without this check, the provider's branch→parent S3 fallback
  // could resurrect an inherited object that the branch already deleted, or
  // expose a parent-side post-fork upload that this branch never received.
  // HeadObject already gates on the metadata row; GetObject must match.
  if (!(await svc.getObjectMetadataRow(bucket, key))) {
    sendS3Error(res, 'NoSuchKey', 'Object does not exist', {
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
