import { Response } from 'express';
import { Readable } from 'stream';
import { StorageService } from '@/services/storage/storage.service.js';
import { ChunkSignatureV4Parser } from '@/services/storage/s3-signature.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_PART_NUMBER = 10_000;

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;

  const partNumberRaw = req.query.partNumber;
  const uploadIdRaw = req.query.uploadId;
  const partNumberStr = typeof partNumberRaw === 'string' ? partNumberRaw : '';
  const uploadId = typeof uploadIdRaw === 'string' ? uploadIdRaw : '';
  // S3 spec: partNumber is an integer in [1, 10000].
  const partNumber = /^\d+$/.test(partNumberStr) ? Number(partNumberStr) : NaN;
  if (!uploadId) {
    sendS3Error(res, 'InvalidRequest', 'Missing uploadId', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PART_NUMBER) {
    sendS3Error(
      res,
      'InvalidArgument',
      `partNumber must be an integer in [1, ${MAX_PART_NUMBER}]`,
      { resource: req.path, requestId: req.s3Auth.requestId }
    );
    return;
  }

  const decodedLen = Number(req.headers['x-amz-decoded-content-length'] ?? 0);
  const plainLen = Number(req.headers['content-length'] ?? 0);
  const contentLength = decodedLen || plainLen;

  if (!Number.isFinite(contentLength) || contentLength < 0) {
    sendS3Error(res, 'InvalidArgument', 'Missing or invalid Content-Length', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
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
