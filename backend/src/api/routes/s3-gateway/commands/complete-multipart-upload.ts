import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml, toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

interface ParsedComplete {
  CompleteMultipartUpload?: {
    Part?:
      | { PartNumber?: string | number; ETag?: string }
      | Array<{ PartNumber?: string | number; ETag?: string }>;
  };
}

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const uploadId = req.query.uploadId as string;

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const parsed = (await parseXml(Buffer.concat(chunks))) as ParsedComplete;
  const partsRaw = parsed?.CompleteMultipartUpload?.Part ?? [];
  const partsArr = Array.isArray(partsRaw) ? partsRaw : [partsRaw];
  const parts = partsArr.map((p) => ({
    partNumber: Number(p.PartNumber),
    etag: String(p.ETag ?? '').replace(/^"(.*)"$/, '$1'),
  }));

  const svc = StorageService.getInstance();
  const { etag, size } = await svc
    .getProvider()
    .completeMultipartUpload(bucket, key, uploadId, parts);

  await svc.upsertS3Object({
    bucket,
    key,
    size,
    etag,
    contentType: null,
    s3AccessKeyId: req.s3Auth.accessKeyId,
  });

  const xml = toXml({
    CompleteMultipartUploadResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Location: `${req.protocol}://${req.headers.host}${req.path}`,
      Bucket: bucket,
      Key: key,
      ETag: `"${etag}"`,
    },
  });
  res.status(200).type('application/xml').send(xml);
}
