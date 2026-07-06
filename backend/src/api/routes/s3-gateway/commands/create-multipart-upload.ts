import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
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
