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

const CONTINUATION_VERSION = 1;
// Marks a token as the versioned payload rather than the bare object key the
// previous format used. NUL is the one byte that can never begin a legacy
// token: storage.objects.key is Postgres `text`, which cannot hold U+0000, so
// no stored key can start with it and the two formats can never be confused.
const CONTINUATION_MARKER = 0x00;

/**
 * Where the previous page stopped. `key` is the last raw object key that was
 * consumed; `prefix` is the CommonPrefix that key collapsed into, if any.
 *
 * The prefix matters because a CommonPrefix stands in for many raw keys. When a
 * page ends part-way through such a group, the cursor still points inside it, so
 * the next page would rebuild the same CommonPrefix and return it a second time.
 * Carrying it in the token lets the next page consume the rest of that group
 * without emitting anything.
 */
interface Continuation {
  key: string;
  prefix?: string;
}

function encodeContinuation(cursor: Continuation): string {
  const payload =
    cursor.prefix === undefined
      ? { v: CONTINUATION_VERSION, k: cursor.key }
      : { v: CONTINUATION_VERSION, k: cursor.key, p: cursor.prefix };
  return Buffer.concat([
    Buffer.from([CONTINUATION_MARKER]),
    Buffer.from(JSON.stringify(payload), 'utf8'),
  ]).toString('base64url');
}

function decodeContinuation(token: string): Continuation | undefined {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length === 0) {
    return undefined;
  }
  if (raw[0] !== CONTINUATION_MARKER) {
    // Tokens issued before the versioned payload were the bare object key.
    return { key: raw.toString('utf8') };
  }
  try {
    const parsed = JSON.parse(raw.subarray(1).toString('utf8')) as {
      v?: unknown;
      k?: unknown;
      p?: unknown;
    };
    if (parsed?.v === CONTINUATION_VERSION && typeof parsed.k === 'string') {
      // Tokens come back from the caller, so only honour a carried prefix that
      // the cursor key actually sits under. That is the one shape this handler
      // ever issues, and an inconsistent pair would otherwise suppress a
      // CommonPrefix no earlier page had returned.
      const carried =
        typeof parsed.p === 'string' && parsed.k.startsWith(parsed.p) ? parsed.p : undefined;
      return { key: parsed.k, prefix: carried };
    }
  } catch {
    // Marked but unparseable, so there is no position to resume from.
  }
  return undefined;
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
  const suppressPrefix = resumeFrom?.prefix;

  // Accumulate visible entries (Contents + CommonPrefixes) up to maxKeys.
  // Track the last DB row we advanced past for continuation.
  const contents: Array<{ Key: string; Size: number; ETag: string; LastModified: string }> = [];
  const commonPrefixesSet = new Set<string>();
  let cursor: Continuation | undefined = continuationToken
    ? resumeFrom
    : startAfter
      ? { key: startAfter }
      : undefined;

  // max-keys=0 asks for no entries at all, so there is nothing to scan and
  // nothing is left unread from the caller's point of view. Scanning anyway
  // stopped on the first row and reported IsTruncated=true with no token to
  // follow, which loops SDK paginators on every non-empty bucket.
  let exhausted = maxKeys === 0;

  for (let page = 0; !exhausted && page < MAX_DB_PAGES; page++) {
    const rows = await svc.listObjectsV2Db({
      bucket,
      prefix,
      startAfter: cursor?.key,
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
      if (delimiter) {
        const tail = r.key.slice(prefix.length);
        const idx = tail.indexOf(delimiter);
        if (idx >= 0) {
          const pfx = prefix + tail.slice(0, idx + delimiter.length);
          // Rows still inside the CommonPrefix the previous page ended on. That
          // prefix was already returned there, so consume them without emitting
          // anything rather than listing the same prefix on two pages.
          if (pfx !== suppressPrefix) {
            commonPrefixesSet.add(pfx);
          }
          cursor = { key: r.key, prefix: pfx };
          continue;
        }
      }
      contents.push({
        Key: r.key,
        Size: r.size,
        ETag: `"${r.etag ?? ''}"`,
        LastModified: r.lastModified.toISOString(),
      });
      cursor = { key: r.key };
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
