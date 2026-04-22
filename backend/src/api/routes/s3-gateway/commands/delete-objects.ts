import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { parseXml, toXml } from '../xml.js';
import { sendS3Error } from '../errors.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

interface ParsedDelete {
  Delete?: {
    Object?: { Key?: string } | Array<{ Key?: string }>;
    Quiet?: string | boolean;
  };
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NoSuchKey' ||
    e?.Code === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);

  let parsed: ParsedDelete;
  try {
    parsed = (await parseXml(body)) as ParsedDelete;
  } catch {
    sendS3Error(res, 'MalformedXML', 'Request body is not valid XML', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const delBlock = parsed?.Delete ?? {};
  const quiet = delBlock.Quiet === true || delBlock.Quiet === 'true';
  let items: Array<{ Key?: string }> = [];
  if (Array.isArray(delBlock.Object)) items = delBlock.Object;
  else if (delBlock.Object) items = [delBlock.Object];
  const keys = items.map((i) => i.Key).filter((k): k is string => !!k);

  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const svc = StorageService.getInstance();

  const deleted: Array<{ Key: string }> = [];
  const errors: Array<{ Key: string; Code: string; Message: string }> = [];

  // Delete each object individually and track outcomes per key. Only count
  // actual deletions (and 404s, per S3 idempotency) as success; provider
  // failures become <Error> entries and their DB rows are NOT removed.
  await Promise.all(
    keys.map(async (k) => {
      try {
        await svc.getProvider().deleteObject(bucket, k);
        deleted.push({ Key: k });
      } catch (err) {
        if (isNotFound(err)) {
          deleted.push({ Key: k });
        } else {
          errors.push({
            Key: k,
            Code: 'InternalError',
            Message: err instanceof Error ? err.message : 'Delete failed',
          });
        }
      }
    })
  );

  // Only delete the DB rows whose provider-side deletes succeeded.
  const successKeys = deleted.map((d) => d.Key);
  await svc.deleteObjectRowsBatch(bucket, successKeys);

  const xml = toXml({
    DeleteResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      ...(quiet ? {} : { Deleted: deleted }),
      ...(errors.length ? { Error: errors } : {}),
    },
  });
  res.status(200).type('application/xml').send(xml);
}
