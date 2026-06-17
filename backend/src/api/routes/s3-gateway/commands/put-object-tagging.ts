import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml } from '../xml.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const key = getS3Key(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }

  if (!(await svc.getObjectMetadataRow(bucket, key))) {
    throw new S3ProtocolError('NoSuchKey', `The specified key does not exist: ${key}`);
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
  const tagging = root.Tagging as Record<string, unknown> | undefined;
  if (!tagging) {
    sendS3Error(res, 'MalformedXML', 'Missing Tagging root element', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const tagSet = tagging.TagSet as Record<string, unknown> | undefined;
  let rawTags = tagSet?.Tag as unknown[] | Record<string, unknown> | undefined;

  const normalizedTags: Array<{ tagKey: string; tagValue: string }> = [];
  if (rawTags) {
    if (!Array.isArray(rawTags)) {
      rawTags = [rawTags];
    }
    for (const t of rawTags as Record<string, unknown>[]) {
      normalizedTags.push({
        tagKey: String(t.Key ?? ''),
        tagValue: String(t.Value ?? ''),
      });
    }
  }

  await svc.putObjectTags(bucket, key, normalizedTags);
  res.status(200).send();
}
