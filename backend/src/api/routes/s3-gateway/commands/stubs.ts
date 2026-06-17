import { Response } from 'express';
import { toXml } from '../xml.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3GatewayRequest } from '../request.js';

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

export async function getBucketVersioning(
  req: S3GatewayRequest,
  res: Response
): Promise<void> {
  const bucket = req.s3Bucket;
  const status = bucket
    ? await StorageService.getInstance().getBucketVersioningStatus(bucket)
    : null;

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
