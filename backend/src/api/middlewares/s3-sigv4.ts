import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { S3AccessKeyService } from '@/services/storage/s3-access-key.service.js';
import { verifyHeaderSignature } from '@/services/storage/s3-signature.js';
import { sendS3Error } from '@/api/routes/s3-gateway/errors.js';
import logger from '@/utils/logger.js';

/**
 * Region used to validate the `Credential=<ak>/<date>/<region>/s3/aws4_request`
 * scope in incoming Authorization headers. Default matches S3StorageProvider's
 * default AWS_REGION so forwarded S3 calls don't need a separate region
 * translation. Override via S3_SIGNING_REGION if this backend runs against a
 * bucket in a different region.
 */
const SIGNING_REGION = process.env.S3_SIGNING_REGION || 'us-east-2';
const MAX_CLOCK_SKEW_MS = 15 * 60 * 1000;

/**
 * Return the raw, percent-encoded path as the client sent it, *including* the
 * gateway mount prefix. Express's `req.path` is URL-decoded (so `hello%20x`
 * becomes `hello x`) which breaks SigV4 canonicalization for object keys with
 * percent-encoded chars. SigV4 also requires the canonical URI to match what
 * the client signed, which is the absolute HTTP path — i.e. the prefix is
 * part of the signed bytes and must not be stripped before verification.
 */
function rawRequestPath(req: Request): string {
  const full = req.originalUrl || req.url;
  const qIdx = full.indexOf('?');
  return qIdx === -1 ? full : full.slice(0, qIdx);
}

export interface S3AuthContext {
  accessKeyId: string;
  s3AccessKeyRowId: string;
  signingKey: Buffer;
  datetime: string;
  scope: string;
  seedSignature: string;
  requestId: string;
  payloadHash: string;
}

export interface S3AuthenticatedRequest extends Request {
  s3Auth: S3AuthContext;
}

function parseAmzDate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export async function s3Sigv4Middleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const requestId = crypto.randomUUID();
  (req as Request & { s3RequestId?: string }).s3RequestId = requestId;

  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('AWS4-HMAC-SHA256')) {
    sendS3Error(res, 'AuthorizationHeaderMalformed', 'Missing or invalid Authorization header', {
      resource: req.path,
      requestId,
    });
    return;
  }

  const amzDate = req.headers['x-amz-date'];
  if (typeof amzDate !== 'string') {
    sendS3Error(res, 'AuthorizationHeaderMalformed', 'Missing x-amz-date header', {
      resource: req.path,
      requestId,
    });
    return;
  }
  const parsed = parseAmzDate(amzDate);
  if (!parsed || Math.abs(Date.now() - parsed.getTime()) > MAX_CLOCK_SKEW_MS) {
    sendS3Error(res, 'RequestTimeTooSkewed', 'Clock skew exceeds 15 minutes', {
      resource: req.path,
      requestId,
    });
    return;
  }

  const payloadHash = (req.headers['x-amz-content-sha256'] as string) ?? 'UNSIGNED-PAYLOAD';

  const credMatch = /Credential=([^/]+)\//.exec(authHeader);
  if (!credMatch) {
    sendS3Error(res, 'AuthorizationHeaderMalformed', 'Missing Credential in Authorization', {
      resource: req.path,
      requestId,
    });
    return;
  }
  const accessKeyId = credMatch[1];

  const svc = S3AccessKeyService.getInstance();
  const resolved = await svc.resolveAccessKeyForVerification(accessKeyId);
  if (!resolved) {
    sendS3Error(res, 'InvalidAccessKeyId', `The access key ${accessKeyId} does not exist`, {
      resource: req.path,
      requestId,
    });
    return;
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(',');
  }

  const rawUrl = req.originalUrl || req.url;
  const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';
  const result = verifyHeaderSignature({
    authorization: authHeader,
    secret: resolved.secret,
    method: req.method,
    path: rawRequestPath(req),
    query,
    headers,
    payloadHash,
    expectedRegion: SIGNING_REGION,
  });

  if (!result.ok) {
    sendS3Error(res, 'SignatureDoesNotMatch', result.reason, {
      resource: req.path,
      requestId,
    });
    return;
  }

  // Fire-and-forget last_used_at update.
  setImmediate(() => {
    svc
      .touchLastUsed(resolved.id)
      .catch((err) => logger.warn('Failed to update last_used_at', { err, accessKeyId }));
  });

  (req as S3AuthenticatedRequest).s3Auth = {
    accessKeyId,
    s3AccessKeyRowId: resolved.id,
    signingKey: result.signingKey,
    datetime: result.datetime,
    scope: result.scope,
    seedSignature: result.seedSignature,
    requestId,
    payloadHash,
  };
  next();
}
