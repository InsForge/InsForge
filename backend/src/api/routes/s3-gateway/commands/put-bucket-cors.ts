import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml } from '../xml.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
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

  const root = parsed as Record<string, unknown>;
  const corsConfig = root.CORSConfiguration as Record<string, unknown> | undefined;
  if (!corsConfig) {
    sendS3Error(res, 'MalformedXML', 'Missing CORSConfiguration root element', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  let rules = corsConfig.CORSRule;
  if (!rules) {
    rules = [];
  } else if (!Array.isArray(rules)) {
    rules = [rules];
  }

  if (rules.length === 0) {
    sendS3Error(res, 'MalformedXML', 'CORSConfiguration must contain at least one CORSRule', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const VALID_METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'HEAD']);

  for (const [i, rule] of (rules as Record<string, unknown>[]).entries()) {
    const methods = normalizeArrayField(rule.AllowedMethod);
    const origins = normalizeArrayField(rule.AllowedOrigin);

    if (methods.length === 0) {
      sendS3Error(res, 'InvalidArgument', `CORSRule ${i} must have at least one AllowedMethod`, {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    for (const m of methods) {
      if (!VALID_METHODS.has(m)) {
        sendS3Error(
          res,
          'InvalidArgument',
          `CORSRule ${i} AllowedMethod "${m}" is not a valid HTTP method`
        );
        return;
      }
    }
    if (origins.length === 0) {
      sendS3Error(res, 'InvalidArgument', `CORSRule ${i} must have at least one AllowedOrigin`, {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    if (rule.MaxAgeSeconds !== undefined) {
      const maxAge = Number(rule.MaxAgeSeconds);
      if (!Number.isFinite(maxAge) || maxAge < 0 || !Number.isInteger(maxAge)) {
        sendS3Error(
          res,
          'InvalidArgument',
          `CORSRule ${i} MaxAgeSeconds must be a non-negative integer`
        );
        return;
      }
      rule.MaxAgeSeconds = maxAge;
    }
    rule.AllowedMethod = methods;
    rule.AllowedOrigin = origins;
    if (rule.AllowedHeader !== undefined) {
      rule.AllowedHeader = normalizeArrayField(rule.AllowedHeader);
    }
    if (rule.ExposeHeader !== undefined) {
      rule.ExposeHeader = normalizeArrayField(rule.ExposeHeader);
    }
  }

  await svc.putBucketCorsRules(bucket, rules as Array<Record<string, unknown>>);
  res.status(200).send();
}

export function normalizeArrayField(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [String(value)];
}
