import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3ProtocolError } from '../errors.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
  const svc = StorageService.getInstance();

  if (!(await svc.bucketExists(bucket))) {
    throw new S3ProtocolError('NoSuchBucket', `The specified bucket does not exist: ${bucket}`);
  }

  const rules = await svc.getBucketCorsRules(bucket);
  if (!rules) {
    throw new S3ProtocolError('NoSuchCORSConfiguration', 'The CORS configuration does not exist');
  }

  const xml = toXml({
    CORSConfiguration: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      CORSRule: rules,
    },
  });
  res.status(200).type('application/xml').send(xml);
}
