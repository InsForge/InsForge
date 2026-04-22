import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const dstBucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const dstKey = (req as unknown as { s3Key: string }).s3Key;

  const source = req.headers['x-amz-copy-source'] as string | undefined;
  if (!source) {
    sendS3Error(res, 'InvalidRequest', 'Missing x-amz-copy-source', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(source.replace(/^\//, ''));
  } catch {
    sendS3Error(res, 'InvalidRequest', 'Malformed x-amz-copy-source', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  const slash = decoded.indexOf('/');
  if (slash === -1) {
    sendS3Error(res, 'InvalidRequest', 'Malformed x-amz-copy-source', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  const srcBucket = decoded.slice(0, slash);
  const srcKey = decoded.slice(slash + 1);

  const svc = StorageService.getInstance();
  const result = await svc.getProvider().copyObject(srcBucket, srcKey, dstBucket, dstKey);

  // Read metadata from the destination after the copy, not from the source —
  // the source may have been mutated or deleted between copy and head, and a
  // null source head would let a 0-size row land in storage.objects.
  const head = await svc.getProvider().headObject(dstBucket, dstKey);

  await svc.upsertS3Object({
    bucket: dstBucket,
    key: dstKey,
    size: head?.size ?? 0,
    etag: result.etag,
    contentType: head?.contentType ?? null,
    s3AccessKeyId: req.s3Auth.accessKeyId,
  });

  const xml = toXml({
    CopyObjectResult: {
      ETag: `"${result.etag}"`,
      LastModified: result.lastModified.toISOString(),
    },
  });
  res.status(200).type('application/xml').send(xml);
}
