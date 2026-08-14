import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { sendS3Error } from '../errors.js';
import { toXml } from '../xml.js';
import { S3GatewayRequest, getS3Bucket } from '../request.js';

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

function decodeContinuation(token: string): string | undefined {
  const key = Buffer.from(token, 'base64url').toString('utf8');
  return key === '' ? undefined : key;
}

/**
 * The CommonPrefix a key collapses into for the given listing parameters, or
 * undefined when the key is listed on its own.
 *
 * This is the single definition of grouping, and it is what lets a continuation
 * token stay a bare position. A CommonPrefix stands in for many raw keys, so a
 * page that ends part-way through such a group leaves the cursor inside it, and
 * the next page would otherwise rebuild and return that prefix a second time.
 * Rather than carry the prefix in the token, the next page recomputes it from
 * the cursor key: the cursor only ever lands mid-group when the page it came
 * from already returned that prefix, and it collapses to nothing when the page
 * ended on a plain key. So the state cannot be inconsistent, or forged into
 * suppressing a prefix this request would not itself rebuild from that key.
 */
function collapsedPrefix(
  key: string,
  prefix: string,
  delimiter: string | undefined
): string | undefined {
  if (!delimiter || !key.startsWith(prefix)) {
    return undefined;
  }
  const tail = key.slice(prefix.length);
  const idx = tail.indexOf(delimiter);
  return idx >= 0 ? prefix + tail.slice(0, idx + delimiter.length) : undefined;
}

export async function handle(req: S3GatewayRequest, res: Response): Promise<void> {
  const bucket = getS3Bucket(req);
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
  // Validate max-keys: S3 accepts integers in [0, 1000] and defaults to 1000.
  // Negative, fractional, or non-numeric values must be rejected before they
  // produce nonsense like MaxKeys=-5 in the response.
  const maxKeysRaw = q['max-keys'];
  let maxKeys: number;
  if (maxKeysRaw === undefined || maxKeysRaw === '') {
    maxKeys = MAX_KEYS_DEFAULT;
  } else {
    if (!/^\d+$/.test(maxKeysRaw)) {
      sendS3Error(res, 'InvalidArgument', `max-keys must be a non-negative integer`, {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    const parsed = Number(maxKeysRaw);
    if (parsed > MAX_KEYS_LIMIT) {
      sendS3Error(res, 'InvalidArgument', `max-keys must be <= ${MAX_KEYS_LIMIT}`, {
        resource: req.path,
        requestId: req.s3Auth.requestId,
      });
      return;
    }
    maxKeys = parsed;
  }

  // S3 ignores start-after whenever continuation-token is present, so the token
  // decides the starting point on its own once the caller supplies one.
  const continuationToken = q['continuation-token'];
  const startAfter = q['start-after'];
  const resumeFrom = continuationToken ? decodeContinuation(continuationToken) : undefined;
  // The CommonPrefix a resumed page must not repeat, recomputed from the cursor
  // under this request's own prefix and delimiter. Only a token gets this: a
  // caller-supplied start-after is a plain position, and S3 still lists the
  // group its key happens to sit in.
  const suppressPrefix = resumeFrom ? collapsedPrefix(resumeFrom, prefix, delimiter) : undefined;

  // Accumulate visible entries (Contents + CommonPrefixes) up to maxKeys.
  // Track the last DB row key we advanced past for continuation.
  const contents: Array<{ Key: string; Size: number; ETag: string; LastModified: string }> = [];
  const commonPrefixesSet = new Set<string>();
  let cursor: string | undefined = resumeFrom ?? (startAfter || undefined);

  // max-keys=0 asks for no entries at all, so there is nothing to scan and
  // nothing is left unread from the caller's point of view. Scanning anyway
  // stopped on the first row and reported IsTruncated=true with no token to
  // follow, which loops SDK paginators on every non-empty bucket.
  let exhausted = maxKeys === 0;

  for (let page = 0; !exhausted && page < MAX_DB_PAGES; page++) {
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
      // maxKeys >= 1 here, so the first row of the first page is always
      // consumed and `cursor` is set before any early stop can happen.
      if (contents.length + commonPrefixesSet.size >= maxKeys) {
        stoppedEarly = true;
        break;
      }
      const pfx = collapsedPrefix(r.key, prefix, delimiter);
      if (pfx !== undefined) {
        // Rows still inside the CommonPrefix the previous page ended on. That
        // prefix was already returned there, so consume them without emitting
        // anything rather than listing the same prefix on two pages.
        if (pfx !== suppressPrefix) {
          commonPrefixesSet.add(pfx);
        }
        cursor = r.key;
        continue;
      }
      contents.push({
        Key: r.key,
        Size: r.size,
        ETag: `"${r.etag ?? ''}"`,
        LastModified: r.lastModified.toISOString(),
      });
      cursor = r.key;
    }
    if (stoppedEarly) {
      break;
    }
    if (rows.length < DB_WINDOW) {
      exhausted = true;
      break;
    }
  }

  // Anything other than a clean walk to the end of the listing leaves rows
  // behind. That covers hitting maxKeys and also hitting MAX_DB_PAGES, which
  // used to report a complete listing while silently dropping the tail.
  //
  // IsTruncated and NextContinuationToken are derived together so they can
  // never disagree: a paginator that sees truncation without a token re-issues
  // the identical request forever.
  const nextContinuation = !exhausted && cursor ? encodeContinuation(cursor) : undefined;
  const truncated = nextContinuation !== undefined;

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
