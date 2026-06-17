import { Response } from 'express';
import { toXml } from '../xml.js';
import { S3ProtocolError } from '../errors.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export function getBucketLocation(_req: S3GatewayRequest, res: Response): Promise<void> {
  res
    .status(200)
    .type('application/xml')
    .send(
      toXml({
        LocationConstraint: {
          $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
          _: 'us-east-2',
        },
      })
    );
  return Promise.resolve();
}

export async function getBucketVersioning(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }
  const status = await svc.getBucketVersioningStatus(bucket);

  res
    .status(200)
    .type('application/xml')
    .send(
      toXml({
        VersioningConfiguration: {
          $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
          Status: status ?? 'Disabled',
        },
      })
    );
}
