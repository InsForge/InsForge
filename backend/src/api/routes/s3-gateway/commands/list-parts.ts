import { Response } from 'express';
import { z } from 'zod';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_PART_NUMBER = 10_000;

// max-parts and part-number-marker are optional integers. Reject negative /
// fractional / non-numeric values up front so we don't pass NaN to the
// provider or echo it back in the XML response.
const querySchema = z.object({
  uploadId: z.string().min(1),
  'max-parts': z.coerce.number().int().min(1).max(1000).optional(),
  'part-number-marker': z.coerce.number().int().min(0).max(MAX_PART_NUMBER).optional(),
});

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;

  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    sendS3Error(
      res,
      'InvalidArgument',
      parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
      { resource: req.path, requestId: req.s3Auth.requestId }
    );
    return;
  }
  const { uploadId } = parsed.data;
  const maxParts = parsed.data['max-parts'];
  const partNumberMarker = parsed.data['part-number-marker'];

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
