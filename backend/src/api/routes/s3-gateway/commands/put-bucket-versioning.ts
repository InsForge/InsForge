import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml } from '../xml.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

const VALID_STATUSES = new Set(['Enabled', 'Suspended']);
const MAX_VERSIONING_BODY_BYTES = 8192;

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }

  const chunks: Buffer[] = [];
  let bodySize = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    bodySize += chunk.length;
    if (bodySize > MAX_VERSIONING_BODY_BYTES) {
      sendS3Error(
        res,
        'EntityTooLarge',
        'Versioning configuration body exceeds maximum allowed size',
        {
          resource: req.path,
          requestId: req.s3Auth.requestId,
        }
      );
      return;
    }
    chunks.push(chunk);
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
  const config = root.VersioningConfiguration as Record<string, unknown> | undefined;
  if (!config) {
    sendS3Error(res, 'MalformedXML', 'Missing VersioningConfiguration root element', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const status = String(config.Status ?? '');
  if (!VALID_STATUSES.has(status)) {
    sendS3Error(res, 'InvalidArgument', `Invalid versioning status "${status}"`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  await svc.putBucketVersioningStatus(bucket, status);
  res.status(200).send();
}
