import { Response } from 'express';
import { Readable } from 'stream';
import { StorageService } from '@/services/storage/storage.service.js';
import { ChunkSignatureV4Parser } from '@/services/storage/s3-signature.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;
  const partNumber = Number(req.query.partNumber);
  const uploadId = req.query.uploadId as string;
  if (!partNumber || !uploadId) {
    sendS3Error(res, 'InvalidRequest', 'Missing partNumber or uploadId', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const decodedLen = Number(req.headers['x-amz-decoded-content-length'] ?? 0);
  const plainLen = Number(req.headers['content-length'] ?? 0);
  const contentLength = decodedLen || plainLen;

  if (contentLength > MAX_PART_BYTES) {
    sendS3Error(res, 'EntityTooLarge', `Part too large: ${contentLength}`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

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
  }

  const { etag } = await StorageService.getInstance()
    .getProvider()
    .uploadPart(bucket, key, uploadId, partNumber, body, contentLength);

  res.status(200).set('ETag', `"${etag}"`).send();
}
