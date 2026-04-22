import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_KEYS_DEFAULT = 1000;
const MAX_KEYS_LIMIT = 1000;

function encodeContinuation(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

function decodeContinuation(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return Buffer.from(token, 'base64url').toString('utf8');
}

export async function handle(req: S3AuthenticatedRequest, res: Response): Promise<void> {
  const bucket = (req as unknown as { s3Bucket: string }).s3Bucket;
  const svc = StorageService.getInstance();
  if (!(await svc.bucketExists(bucket))) {
    sendS3Error(res, 'NoSuchBucket', `Bucket ${bucket} does not exist`, {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }

  const q = req.query as Record<string, string | undefined>;
  const prefix = q['prefix'] ?? '';
  const delimiter = q['delimiter'];
  const maxKeys = Math.min(
    Number(q['max-keys'] ?? MAX_KEYS_DEFAULT) || MAX_KEYS_DEFAULT,
    MAX_KEYS_LIMIT
  );
  const startAfter = q['start-after'] ?? decodeContinuation(q['continuation-token']);

  const raw = await svc.listObjectsV2Db({
    bucket,
    prefix,
    startAfter,
    maxKeys: maxKeys + 1,
  });
  const isTruncated = raw.length > maxKeys;
  const rows = isTruncated ? raw.slice(0, maxKeys) : raw;

  const contents: Array<{ Key: string; Size: number; ETag: string; LastModified: string }> = [];
  const commonPrefixesSet = new Set<string>();
  for (const r of rows) {
    if (delimiter) {
      const tail = r.key.slice(prefix.length);
      const idx = tail.indexOf(delimiter);
      if (idx >= 0) {
        commonPrefixesSet.add(prefix + tail.slice(0, idx + delimiter.length));
        continue;
      }
    }
    contents.push({
      Key: r.key,
      Size: r.size,
      ETag: `"${r.etag ?? ''}"`,
      LastModified: r.lastModified.toISOString(),
    });
  }

  const nextContinuation = isTruncated
    ? encodeContinuation(rows[rows.length - 1].key)
    : undefined;

  const xml = toXml({
    ListBucketResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Name: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
      KeyCount: contents.length + commonPrefixesSet.size,
      IsTruncated: isTruncated,
      ...(nextContinuation ? { NextContinuationToken: nextContinuation } : {}),
      ...(delimiter ? { Delimiter: delimiter } : {}),
      ...(contents.length ? { Contents: contents } : {}),
      ...(commonPrefixesSet.size
        ? { CommonPrefixes: Array.from(commonPrefixesSet).map((p) => ({ Prefix: p })) }
        : {}),
    },
  });

  res.status(200).type('application/xml').send(xml);
}
