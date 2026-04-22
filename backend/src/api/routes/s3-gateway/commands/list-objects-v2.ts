import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

const MAX_KEYS_DEFAULT = 1000;
const MAX_KEYS_LIMIT = 1000;
// With delimiter=/, many raw keys may collapse into a single CommonPrefix.
// We fetch the DB in windows and accumulate visible entries until we hit
// maxKeys. This cap bounds total DB work per request.
const DB_WINDOW = 1000;
const MAX_DB_PAGES = 200;

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
  const startAfterInput = q['start-after'] ?? decodeContinuation(q['continuation-token']);

  // Accumulate visible entries (Contents + CommonPrefixes) up to maxKeys.
  // Track the last DB row key we advanced past for continuation.
  const contents: Array<{ Key: string; Size: number; ETag: string; LastModified: string }> = [];
  const commonPrefixesSet = new Set<string>();
  let cursor: string | undefined = startAfterInput;
  let exhausted = false;
  let truncated = false;

  for (let page = 0; page < MAX_DB_PAGES; page++) {
    const rows = await svc.listObjectsV2Db({
      bucket,
      prefix,
      startAfter: cursor,
      maxKeys: DB_WINDOW,
    });
    if (rows.length === 0) {
      exhausted = true;
      break;
    }

    let stoppedEarly = false;
    for (const r of rows) {
      const visible = contents.length + commonPrefixesSet.size;
      if (visible >= maxKeys) {
        truncated = true;
        stoppedEarly = true;
        break;
      }
      if (delimiter) {
        const tail = r.key.slice(prefix.length);
        const idx = tail.indexOf(delimiter);
        if (idx >= 0) {
          const pfx = prefix + tail.slice(0, idx + delimiter.length);
          if (!commonPrefixesSet.has(pfx)) {
            if (visible + 1 > maxKeys) {
              truncated = true;
              stoppedEarly = true;
              break;
            }
            commonPrefixesSet.add(pfx);
          }
          cursor = r.key;
          continue;
        }
      }
      contents.push({
        Key: r.key,
        Size: r.size,
        ETag: `"${r.etag ?? ''}"`,
        LastModified: r.lastModified.toISOString(),
      });
      cursor = r.key;
    }
    if (stoppedEarly) break;
    if (rows.length < DB_WINDOW) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted && !truncated && contents.length + commonPrefixesSet.size >= maxKeys) {
    truncated = true;
  }

  const nextContinuation = truncated && cursor ? encodeContinuation(cursor) : undefined;

  const xml = toXml({
    ListBucketResult: {
      $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
      Name: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
      KeyCount: contents.length + commonPrefixesSet.size,
      IsTruncated: truncated,
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
