import { Response } from 'express';
import { toXml } from '../xml.js';
import { StorageService } from '@/services/storage/storage.service.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function getBucketLocation(_req: S3GatewayRequest, res: Response): Promise<void> {
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
}

export async function getBucketVersioning(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const status = await StorageService.getInstance().getBucketVersioningStatus(bucket);

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
