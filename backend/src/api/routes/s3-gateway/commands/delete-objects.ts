import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml, toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

interface ParsedDelete {
  Delete?: {
    Object?: { Key?: string } | Array<{ Key?: string }>;
  };
}

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const parsed = (await parseXml(body)) as ParsedDelete;
  const delBlock = parsed?.Delete ?? {};
  let items: Array<{ Key?: string }> = [];
  if (Array.isArray(delBlock.Object)) items = delBlock.Object;
  else if (delBlock.Object) items = [delBlock.Object];

  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const keys = items.map((i) => i.Key).filter((k): k is string => !!k);

  const svc = StorageService.getInstance();
  const deleted: Array<{ Key: string }> = [];
  await Promise.all(
    keys.map(async (k) => {
      try {
        await svc.getProvider().deleteObject(bucket, k);
      } catch {
        // Swallow — S3 returns success for not-found deletes.
      }
      deleted.push({ Key: k });
    })
  );
  await svc.deleteObjectRowsBatch(bucket, keys);

  const xml = toXml({
    DeleteResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Deleted: deleted,
    },
  });
  res.status(200).type('application/xml').send(xml);
}
