import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const contentType = (req.headers['content-type'] as string) ?? 'application/octet-stream';
  const { uploadId } = await StorageService.getInstance()
    .getProvider()
    .createMultipartUpload(bucket, key, { contentType });
  const xml = toXml({
    InitiateMultipartUploadResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    },
  });
  res.status(200).type('application/xml').send(xml);
}
