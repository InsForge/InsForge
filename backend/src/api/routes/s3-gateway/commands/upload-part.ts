import { Response } from 'express';
import { Readable, Transform, TransformCallback } from 'stream';
import { StorageService } from '@/services/storage/storage.service.js';
import { ChunkSignatureV4Parser } from '@/services/storage/s3-signature.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_PART_NUMBER = 10_000;

class ByteLimitStream extends Transform {
  private received = 0;
  constructor(private readonly limit: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.limit) {
      cb(new S3ProtocolError('EntityTooLarge', `Part exceeds size cap (${this.limit} bytes)`));
      return;
    }
    cb(null, chunk);
  }
}

function parseDecodedLength(raw: unknown): number | null {
  if (typeof raw !== 'string') {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  return Number(raw);
}

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const key = (req as unknown as { s3Key: string }).s3Key;

  const partNumberRaw = req.query.partNumber;
  const uploadIdRaw = req.query.uploadId;
  const partNumberStr = typeof partNumberRaw === 'string' ? partNumberRaw : '';
  const uploadId = typeof uploadIdRaw === 'string' ? uploadIdRaw : '';
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

  const isStreaming = req.s3Auth.payloadHash === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
  const decodedLen = parseDecodedLength(req.headers['x-amz-decoded-content-length']);
  const plainLen = Number(req.headers['content-length'] ?? 0);
  // Streaming parts: x-amz-decoded-content-length is authoritative (0 is valid).
  // Non-streaming: Content-Length is the payload size.
  const contentLength: number | null = isStreaming
    ? decodedLen
    : Number.isFinite(plainLen) && plainLen >= 0
      ? plainLen
      : null;

  if (contentLength === null) {
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
  if (isStreaming) {
    const parser = new ChunkSignatureV4Parser({
      seedSignature: req.s3Auth.seedSignature,
      signingKey: req.s3Auth.signingKey,
      datetime: req.s3Auth.datetime,
      scope: req.s3Auth.scope,
    });
    const limiter = new ByteLimitStream(MAX_PART_BYTES);
    req.pipe(parser).pipe(limiter);
    body = limiter;
  }

  const { etag } = await StorageService.getInstance()
    .getProvider()
    .uploadPart(bucket, key, uploadId, partNumber, body, contentLength);

  res.status(200).set('ETag', `"${etag}"`).send();
}
