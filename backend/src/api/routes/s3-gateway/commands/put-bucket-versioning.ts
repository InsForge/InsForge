import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml } from '../xml.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

const VALID_STATUSES = new Set(['Enabled', 'Suspended']);

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
