import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml } from '../xml.js';
import { sendS3Error, S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket, getS3Key } from '../request.js';

const MAX_TAG_COUNT = 10;
const MAX_TAG_KEY_LENGTH = 128;
const MAX_TAG_VALUE_LENGTH = 256;
const MAX_TAGGING_BODY_BYTES = 65536;

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
  let bodySize = 0;
  for await (const c of req) {
    const chunk = c as Buffer;
    bodySize += chunk.length;
    if (bodySize > MAX_TAGGING_BODY_BYTES) {
      sendS3Error(res, 'EntityTooLarge', 'Tagging body exceeds maximum allowed size', {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
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
      const tagKey = String(t.Key ?? '');
      const tagValue = String(t.Value ?? '');
      if (!tagKey || tagKey.length > MAX_TAG_KEY_LENGTH) {
        sendS3Error(
          res,
          'InvalidArgument',
          `Tag key must be between 1 and ${MAX_TAG_KEY_LENGTH} characters`
        );
        return;
      }
      if (tagKey.startsWith('aws:')) {
        sendS3Error(res, 'InvalidArgument', 'Tag keys must not start with "aws:"');
        return;
      }
      if (tagValue.length > MAX_TAG_VALUE_LENGTH) {
        sendS3Error(
          res,
          'InvalidArgument',
          `Tag value must be between 0 and ${MAX_TAG_VALUE_LENGTH} characters`
        );
        return;
      }
      normalizedTags.push({ tagKey, tagValue });
    }
  }

  if (normalizedTags.length > MAX_TAG_COUNT) {
    sendS3Error(res, 'InvalidArgument', `Tags count must not exceed ${MAX_TAG_COUNT}`);
    return;
  }

  const seen = new Set<string>();
  for (const t of normalizedTags) {
    if (seen.has(t.tagKey)) {
      sendS3Error(res, 'InvalidArgument', `Duplicate tag key: ${t.tagKey}`);
      return;
    }
    seen.add(t.tagKey);
  }

  await svc.putObjectTags(bucket, key, normalizedTags);
  res.status(200).send();
}
