import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

export async function handle(_req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const buckets = await StorageService.getInstance().listAllBucketsSimple();
  const xml = toXml({
    ListAllMyBucketsResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Owner: { ID: 'insforge', DisplayName: 'insforge' },
      Buckets: {
        Bucket: buckets.map((b) => ({
          Name: b.name,
          CreationDate: b.createdAt.toISOString(),
        })),
      },
    },
  });
  res.status(200).type('application/xml').send(xml);
}
