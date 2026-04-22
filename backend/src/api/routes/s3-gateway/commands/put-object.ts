import { Response } from 'express';
import { Readable } from 'stream';
import crypto from 'crypto';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';
import { ChunkSignatureV4Parser } from '@/services/storage/s3-signature.js';

const AWS_MAX_PUT_OBJECT_GB = 5;

function capBytes(): number {
  const override = Number(process.env.S3_PROTOCOL_MAX_OBJECT_SIZE_GB);
  const effective =
    Number.isFinite(override) && override > 0 && override < AWS_MAX_PUT_OBJECT_GB
      ? override
      : AWS_MAX_PUT_OBJECT_GB;
  return effective * 1024 * 1024 * 1024;
}

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

  // In a STREAMING-* request the header Content-Length counts the chunk framing;
  // the real payload size is in x-amz-decoded-content-length.
  const decodedLen = Number(req.headers['x-amz-decoded-content-length'] ?? 0);
  const plainLen = Number(req.headers['content-length'] ?? 0);
  const contentLength = decodedLen || plainLen;

  const cap = capBytes();
  if (contentLength > cap) {
    sendS3Error(res, 'EntityTooLarge', `Object too large: ${contentLength} > ${cap}`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const contentType = (req.headers['content-type'] as string) || 'application/octet-stream';
  let body: Readable = req;

  if (req.s3Auth.payloadHash === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD') {
    const parser = new ChunkSignatureV4Parser({
      seedSignature: req.s3Auth.seedSignature,
      signingKey: req.s3Auth.signingKey,
      datetime: req.s3Auth.datetime,
      scope: req.s3Auth.scope,
    });
    req.pipe(parser);
    body = parser;
  } else if (req.s3Auth.payloadHash !== 'UNSIGNED-PAYLOAD') {
    // Pre-hashed body: buffer and verify SHA-256 matches the declared hash.
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);
    const digest = crypto.createHash('sha256').update(buf).digest('hex');
    if (digest !== req.s3Auth.payloadHash) {
      sendS3Error(res, 'SignatureDoesNotMatch', 'Body hash mismatch', {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    body = Readable.from(buf);
  }

  const result = await svc.getProvider().putObjectStream(bucket, key, body, {
    contentType,
    contentLength: contentLength || undefined,
  });

  await svc.upsertS3Object({
    bucket,
    key,
    size: result.size || contentLength,
    etag: result.etag,
    contentType,
    s3AccessKeyId: req.s3Auth.accessKeyId,
  });

  res.status(200).set('ETag', `"${result.etag}"`).send();
}
