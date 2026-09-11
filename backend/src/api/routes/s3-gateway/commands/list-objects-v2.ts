import crypto from 'crypto';
import { Response } from 'express';
import { StorageService } from '@/services/storage/storage.service.js';
import { appConfig } from '@/infra/config/app.config.js';
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

// A continuation token is `base64url(cursor key).base64url(signature)`, where
// the signature is a truncated HMAC binding the key to the listing that issued
// it. 128 bits is well past what forging a position is worth, and keeps the
// token short.
//
// The separator is what makes the format self-describing. base64url output
// never contains a dot, so a token without one is unambiguously an unsigned
// token from a release before this, and is handled as such rather than being
// misread as a signed one.
const CONTINUATION_SIGNATURE_BYTES = 16;
const CONTINUATION_SEPARATOR = '.';

/** The listing parameters a continuation token is only valid within. */
interface ListingScope {
  bucket: string;
  prefix: string;
  delimiter: string | undefined;
}

/**
 * The HMAC key, or undefined when the instance has no JWT_SECRET configured.
 *
 * Signing with the empty string would be worse than not signing at all: the key
 * is then public, so anyone could mint a token that verifies, and the code would
 * grant it the trust a real signature earns. Without a secret this handler
 * issues unsigned tokens instead, which cost only the CommonPrefix de-duplication
 * across pages and leave the listing no worse than it is today.
 */
function continuationSigningKey(): string | undefined {
  return appConfig.app.jwtSecret || undefined;
}

function continuationSignature(secret: string, scope: ListingScope, key: string): Buffer {
  // Length-prefix every field so no combination of bucket, prefix, delimiter
  // and key can be rearranged into the same signed string. Keys and delimiters
  // are arbitrary text, so there is no separator character safe to reserve.
  const signed = ['insforge:s3:listv2:v1', scope.bucket, scope.prefix, scope.delimiter ?? '', key]
    .map((field) => `${Buffer.byteLength(field, 'utf8')}:${field}`)
    .join('');
  return crypto
    .createHmac('sha256', secret)
    .update(signed)
    .digest()
    .subarray(0, CONTINUATION_SIGNATURE_BYTES);
}

function encodeContinuation(scope: ListingScope, key: string): string {
  const payload = Buffer.from(key, 'utf8').toString('base64url');
  const secret = continuationSigningKey();
  if (!secret) {
    return payload;
  }
  return `${payload}${CONTINUATION_SEPARATOR}${continuationSignature(secret, scope, key).toString('base64url')}`;
}

/**
 * Where a token says to resume, and whether this server can prove it issued it
 * for this listing. Only a proven token gets to suppress a CommonPrefix; an
 * unsigned one is treated as a plain position, which is no more than the caller
 * could already ask for with start-after.
 */
interface ResumePoint {
  key: string;
  verified: boolean;
}

function decodeContinuation(scope: ListingScope, token: string): ResumePoint | undefined {
  const separator = token.indexOf(CONTINUATION_SEPARATOR);
  if (separator === -1) {
    // Issued before tokens were signed, or by an instance with no signing key.
    // Honour the position so a listing walk that spans the upgrade still
    // advances, but not the suppression, which depends on this server having
    // issued the page it came from.
    const key = Buffer.from(token, 'base64url').toString('utf8');
    return key === '' ? undefined : { key, verified: false };
  }

  const secret = continuationSigningKey();
  if (!secret) {
    // Nothing to verify against, and this instance never issues signed tokens,
    // so a signed one did not come from here.
    return undefined;
  }

  const key = Buffer.from(token.slice(0, separator), 'base64url').toString('utf8');
  const claimed = Buffer.from(token.slice(separator + 1), 'base64url');
  const expected = continuationSignature(secret, scope, key);
  if (claimed.length !== expected.length || !crypto.timingSafeEqual(claimed, expected)) {
    return undefined;
  }
  return { key, verified: true };
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
  const scope: ListingScope = { bucket, prefix, delimiter };
  const continuationToken = q['continuation-token'];
  const startAfter = q['start-after'];
  // Presence, not truthiness: `continuation-token=` is a token the caller
  // supplied and expects to resume from, so it must be rejected rather than
  // quietly falling through to start-after.
  const resumeFrom =
    continuationToken !== undefined ? decodeContinuation(scope, continuationToken) : undefined;
  // A signed token that does not verify was tampered with, or belongs to a
  // different listing, so it names no position to resume from. Restarting
  // silently would answer 200 with keys the caller has already processed.
  if (continuationToken !== undefined && resumeFrom === undefined) {
    sendS3Error(res, 'InvalidArgument', 'The continuation token provided is incorrect', {
      resource: req.path,
      requestId: req.s3Auth.requestId,
    });
    return;
  }
  // The CommonPrefix a resumed page must not repeat, recomputed from the cursor
  // under this request's own prefix and delimiter. Only a verified token earns
  // this, because choosing the cursor chooses which group disappears. A
  // start-after, or an unsigned token, is a plain position: S3 still lists the
  // group its key happens to sit in.
  const suppressPrefix = resumeFrom?.verified
    ? collapsedPrefix(resumeFrom.key, prefix, delimiter)
    : undefined;

  // Accumulate visible entries (Contents + CommonPrefixes) up to maxKeys.
  // Track the last DB row key we advanced past for continuation.
  const contents: Array<{ Key: string; Size: number; ETag: string; LastModified: string }> = [];
  const commonPrefixesSet = new Set<string>();
  let cursor: string | undefined = resumeFrom?.key ?? (startAfter || undefined);

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
  const nextContinuation = !exhausted && cursor ? encodeContinuation(scope, cursor) : undefined;
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
