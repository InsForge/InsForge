import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const uploadId = req.query.uploadId as string;
  const maxParts = req.query['max-parts'] ? Number(req.query['max-parts']) : undefined;
  const partNumberMarker = req.query['part-number-marker']
    ? Number(req.query['part-number-marker'])
    : undefined;

  const result = await StorageService.getInstance()
    .getProvider()
    .listParts(bucket, key, uploadId, { maxParts, partNumberMarker });

  const xml = toXml({
    ListPartsResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MaxParts: maxParts ?? 1000,
      IsTruncated: result.isTruncated,
      ...(result.nextPartNumberMarker !== undefined && result.nextPartNumberMarker !== null
        ? { NextPartNumberMarker: result.nextPartNumberMarker }
        : {}),
      Part: result.parts.map((p) => ({
        PartNumber: p.partNumber,
        ETag: `"${p.etag}"`,
        Size: p.size,
        LastModified: p.lastModified.toISOString(),
      })),
    },
  });
  res.status(200).type('application/xml').send(xml);
}
