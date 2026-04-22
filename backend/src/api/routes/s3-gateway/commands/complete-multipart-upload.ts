import { Response } from 'express';
import { z } from 'zod';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml, toXml } from '../xml.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const partSchema = z.object({
  PartNumber: z.coerce.number().int().positive().max(10_000),
  ETag: z.string().min(1),
});

const bodySchema = z.object({
  CompleteMultipartUpload: z.object({
    Part: z.union([partSchema, z.array(partSchema).nonempty()]),
  }),
});

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const uploadIdRaw = req.query.uploadId;
  const uploadId = typeof uploadIdRaw === 'string' ? uploadIdRaw : '';
  if (!uploadId) {
    sendS3Error(res, 'InvalidRequest', 'Missing uploadId', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }

  let parsed: unknown;
  try {
    parsed = await parseXml(Buffer.concat(chunks));
  } catch {
    sendS3Error(res, 'MalformedXML', 'Request body is not valid XML', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const validation = bodySchema.safeParse(parsed);
  if (!validation.success) {
    sendS3Error(res, 'InvalidPart', validation.error.issues.map((e) => e.message).join('; '), {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const partEntry = validation.data.CompleteMultipartUpload.Part;
  const partsArr = Array.isArray(partEntry) ? partEntry : [partEntry];
  const parts = partsArr.map((p) => ({
    partNumber: p.PartNumber,
    etag: p.ETag.replace(/^"(.*)"$/, '$1'),
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
