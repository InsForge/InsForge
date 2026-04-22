import { Response } from 'express';
import { Readable, Transform, TransformCallback } from 'stream';
import crypto from 'crypto';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
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

/**
 * Transform that counts bytes and errors if it exceeds the cap. Used on the
 * streaming PutObject / UploadPart path to enforce the per-object ceiling
 * regardless of whatever Content-Length / x-amz-decoded-content-length the
 * client declared.
 */
class ByteLimitStream extends Transform {
  private received = 0;
  constructor(private readonly limit: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.limit) {
      cb(new S3ProtocolError('EntityTooLarge', `Object exceeds size cap (${this.limit} bytes)`));
      return;
    }
    cb(null, chunk);
  }
}

/**
 * Parse the decoded payload length from a STREAMING-* request.
 * `x-amz-decoded-content-length` is the authoritative payload size (bytes
 * after chunk-framing is stripped). An explicit "0" is a valid length, not
 * "absent" — a zero-byte streaming upload is legal. Only truly missing /
 * non-numeric headers are treated as unknown.
 */
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
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    sendS3Error(res, 'NoSuchBucket', 'Bucket does not exist', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const isStreaming = req.s3Auth.payloadHash === 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD';
  const decodedLen = parseDecodedLength(req.headers['x-amz-decoded-content-length']);
  const plainLen = Number(req.headers['content-length'] ?? 0);
  // For streaming requests the real payload size is x-amz-decoded-content-length
  // (0 is valid). For non-streaming we use Content-Length. When neither is
  // available, we pass undefined to the provider and rely on the running
  // byte-limit transform to stop the stream if it goes over cap.
  const contentLength: number | null = isStreaming
    ? decodedLen
    : Number.isFinite(plainLen)
      ? plainLen
      : null;

  const cap = capBytes();
  if (contentLength !== null && contentLength > cap) {
    sendS3Error(res, 'EntityTooLarge', `Object too large: ${contentLength} > ${cap}`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const contentType = (req.headers['content-type'] as string) || 'application/octet-stream';
  let body: Readable = req;

  if (isStreaming) {
    const parser = new ChunkSignatureV4Parser({
      seedSignature: req.s3Auth.seedSignature,
      signingKey: req.s3Auth.signingKey,
      datetime: req.s3Auth.datetime,
      scope: req.s3Auth.scope,
    });
    // Pipe chunk-verified output through a byte-limit transform so a client
    // lying about x-amz-decoded-content-length can't stream past the cap.
    const limiter = new ByteLimitStream(cap);
    req.pipe(parser).pipe(limiter);
    body = limiter;
  } else if (req.s3Auth.payloadHash !== 'UNSIGNED-PAYLOAD') {
    // Pre-hashed body: buffer and verify SHA-256 matches the declared hash.
    // Enforce a running byte-count cap so a client can't force an unbounded
    // buffer by lying about Content-Length.
    const chunks: Buffer[] = [];
    let received = 0;
    const hasher = crypto.createHash('sha256');
    let tooLarge = false;
    for await (const c of req) {
      const b = c as Buffer;
      received += b.length;
      if (received > cap) {
        tooLarge = true;
        req.unpipe?.();
        req.destroy?.();
        break;
      }
      hasher.update(b);
      chunks.push(b);
    }
    if (tooLarge) {
      sendS3Error(res, 'EntityTooLarge', `Object exceeds size cap (${cap} bytes)`, {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    const digest = hasher.digest('hex');
    if (digest !== req.s3Auth.payloadHash) {
      sendS3Error(res, 'SignatureDoesNotMatch', 'Body hash mismatch', {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    body = Readable.from(Buffer.concat(chunks));
  }

  const result = await svc.getProvider().putObjectStream(bucket, key, body, {
    contentType,
    contentLength: contentLength ?? undefined,
  });

  await svc.upsertS3Object({
    bucket,
    key,
    size: result.size || contentLength || 0,
    etag: result.etag,
    contentType,
    s3AccessKeyId: req.s3Auth.accessKeyId,
  });

  res.status(200).set('ETag', `"${result.etag}"`).send();
}
