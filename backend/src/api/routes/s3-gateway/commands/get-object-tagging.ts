import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3ProtocolError } from '../errors.js';
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

  const tags = await svc.getObjectTags(bucket, key);

  const tagElements = tags.map((t) => ({ Key: t.tagKey, Value: t.tagValue }));
  const tagSet: Record<string, unknown> =
    tagElements.length === 0
      ? {}
      : { Tag: tagElements.length === 1 ? tagElements[0] : tagElements };

  const xml = toXml({
    Tagging: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      TagSet: tagSet,
    },
  });
  res.status(200).type('application/xml').send(xml);
}
