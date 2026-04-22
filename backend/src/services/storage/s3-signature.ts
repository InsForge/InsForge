import crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';

export interface CanonicalRequestInput {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  signedHeaders: string[];
  payloadHash: string;
}

/**
 * Encode per AWS SigV4 rules:
 *   - Unreserved: A-Z a-z 0-9 - _ . ~
 *   - Space → %20 (not +)
 *   - '/' in path segments is NOT encoded when encodeSlash=false
 */
function uriEncode(str: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of str) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) {
      out += ch;
    } else if (ch === '/' && !encodeSlash) {
      out += '/';
    } else {
      const bytes = Buffer.from(ch, 'utf8');
      for (const b of bytes) {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

function canonicalizePath(p: string): string {
  // Decode once then re-encode per segment. This handles both decoded input
  // ("/hello world.jpg") and already-encoded input ("/hello%20world.jpg")
  // without double-encoding the latter ("/hello%2520world.jpg").
  return p
    .split('/')
    .map((segment) => uriEncode(safeDecode(segment), true))
    .join('/');
}

function canonicalizeQuery(q: string): string {
  if (!q) return '';
  const pairs = q.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    const dk = safeDecode(k);
    const dv = safeDecode(v);
    return [uriEncode(dk, true), uriEncode(dv, true)] as [string, string];
  });
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildCanonicalRequest(input: CanonicalRequestInput): string {
  const canonicalHeaders = input.signedHeaders
    .map((h) => {
      const rawEntry =
        input.headers[h] ??
        input.headers[h.toLowerCase()] ??
        Object.entries(input.headers).find(([k]) => k.toLowerCase() === h)?.[1];
      const raw = rawEntry ?? '';
      const val = String(raw).replace(/\s+/g, ' ').trim();
      return `${h}:${val}`;
    })
    .join('\n');

  return [
    input.method.toUpperCase(),
    canonicalizePath(input.path),
    canonicalizeQuery(input.query),
    canonicalHeaders,
    '',
    input.signedHeaders.join(';'),
    input.payloadHash,
  ].join('\n');
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function deriveSigningKey(
  secret: string,
  date: string,
  region: string,
  service: string
): Buffer {
  const kDate = crypto.createHmac('sha256', `AWS4${secret}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  return crypto.createHmac('sha256', kService).update('aws4_request').digest();
}

export function buildStringToSign(input: {
  datetime: string;
  scope: string;
  canonicalRequestHash: string;
}): string {
  return ['AWS4-HMAC-SHA256', input.datetime, input.scope, input.canonicalRequestHash].join('\n');
}

const AUTH_RE =
  /^AWS4-HMAC-SHA256\s+Credential=([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]+)\s*$/i;

export interface VerifyInput {
  authorization: string;
  secret: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  payloadHash: string;
  expectedRegion: string;
}

export type VerifyResult =
  | {
      ok: true;
      accessKeyId: string;
      signingKey: Buffer;
      datetime: string;
      scope: string;
      seedSignature: string;
    }
  | { ok: false; reason: string };

export function verifyHeaderSignature(input: VerifyInput): VerifyResult {
  const m = AUTH_RE.exec(input.authorization);
  if (!m) return { ok: false, reason: 'AuthorizationHeaderMalformed' };
  const [, accessKeyId, date, region, service, signedHeadersStr, clientSig] = m;
  if (service !== 's3') return { ok: false, reason: 'Wrong service in scope' };
  if (region !== input.expectedRegion) return { ok: false, reason: `Wrong region: ${region}` };

  const datetime =
    input.headers['x-amz-date'] ??
    input.headers['X-Amz-Date'] ??
    Object.entries(input.headers).find(([k]) => k.toLowerCase() === 'x-amz-date')?.[1] ??
    '';
  if (!datetime) return { ok: false, reason: 'Missing x-amz-date' };
  if (datetime.slice(0, 8) !== date) return { ok: false, reason: 'Date mismatch' };

  const signedHeaders = signedHeadersStr
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .sort();

  const canonical = buildCanonicalRequest({
    method: input.method,
    path: input.path,
    query: input.query,
    headers: input.headers,
    signedHeaders,
    payloadHash: input.payloadHash,
  });
  const scope = `${date}/${region}/s3/aws4_request`;
  const sts = buildStringToSign({
    datetime,
    scope,
    canonicalRequestHash: sha256Hex(canonical),
  });
  const signingKey = deriveSigningKey(input.secret, date, region, 's3');
  const computedSig = crypto.createHmac('sha256', signingKey).update(sts).digest('hex');

  if (computedSig.length !== clientSig.length) {
    return { ok: false, reason: 'SignatureDoesNotMatch' };
  }
  const equal = crypto.timingSafeEqual(
    Buffer.from(computedSig, 'hex'),
    Buffer.from(clientSig, 'hex')
  );
  if (!equal) return { ok: false, reason: 'SignatureDoesNotMatch' };

  return {
    ok: true,
    accessKeyId,
    signingKey,
    datetime,
    scope,
    seedSignature: computedSig,
  };
}

// ============================================================================
// Streaming SigV4: STREAMING-AWS4-HMAC-SHA256-PAYLOAD chunk parser
// ============================================================================

export interface ChunkParserOptions {
  seedSignature: string;
  signingKey: Buffer;
  datetime: string;
  scope: string;
}

type ParserState = 'HEADER' | 'DATA' | 'AFTER_DATA_CRLF' | 'DONE';

/**
 * Transform stream that consumes a STREAMING-AWS4-HMAC-SHA256-PAYLOAD body,
 * verifies each chunk's signature against the previous chunk's signature
 * (seeded by the header signature), and emits only the verified raw payload
 * bytes to downstream consumers. Throws SignatureDoesNotMatch on any
 * mismatch. Memory usage is bounded by the buffered trailing-chunk fragment
 * plus MAX_HEADER_LEN per header.
 */
export class ChunkSignatureV4Parser extends Transform {
  private state: ParserState = 'HEADER';
  private prevSig: string;
  private readonly signingKey: Buffer;
  private readonly datetime: string;
  private readonly scope: string;
  private buffer: Buffer = Buffer.alloc(0);
  private remainingChunkBytes = 0;
  private declaredChunkSig = '';
  private chunkHash = crypto.createHash('sha256');
  private sawTerminator = false;
  private static readonly MAX_HEADER_LEN = 256;
  private static readonly EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

  constructor(opts: ChunkParserOptions) {
    super();
    this.prevSig = opts.seedSignature;
    this.signingKey = opts.signingKey;
    this.datetime = opts.datetime;
    this.scope = opts.scope;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
      this.pump();
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  _flush(cb: TransformCallback): void {
    if (this.state !== 'DONE') {
      cb(new Error('SignatureDoesNotMatch: stream ended before terminator chunk'));
      return;
    }
    cb();
  }

  private pump(): void {
    while (true) {
      if (this.state === 'HEADER') {
        const nlIdx = this.buffer.indexOf('\r\n');
        if (nlIdx === -1) {
          if (this.buffer.length > ChunkSignatureV4Parser.MAX_HEADER_LEN) {
            throw new Error('SignatureDoesNotMatch: chunk header too long');
          }
          return;
        }
        const header = this.buffer.slice(0, nlIdx).toString('ascii');
        this.buffer = this.buffer.slice(nlIdx + 2);
        const match = /^([0-9a-fA-F]+);chunk-signature=([0-9a-fA-F]{64})$/.exec(header);
        if (!match) throw new Error('SignatureDoesNotMatch: malformed chunk header');
        this.remainingChunkBytes = parseInt(match[1], 16);
        this.declaredChunkSig = match[2];
        this.chunkHash = crypto.createHash('sha256');
        if (this.remainingChunkBytes === 0) {
          this.verifyHash(ChunkSignatureV4Parser.EMPTY_SHA256);
          this.sawTerminator = true;
          this.state = 'AFTER_DATA_CRLF';
        } else {
          this.state = 'DATA';
        }
      } else if (this.state === 'DATA') {
        if (this.buffer.length === 0) return;
        const take = Math.min(this.buffer.length, this.remainingChunkBytes);
        const payload = this.buffer.slice(0, take);
        this.chunkHash.update(payload);
        this.push(payload);
        this.buffer = this.buffer.slice(take);
        this.remainingChunkBytes -= take;
        if (this.remainingChunkBytes === 0) {
          this.verifyHash(this.chunkHash.digest('hex'));
          this.state = 'AFTER_DATA_CRLF';
        }
      } else if (this.state === 'AFTER_DATA_CRLF') {
        if (this.buffer.length < 2) return;
        if (this.buffer[0] !== 0x0d || this.buffer[1] !== 0x0a) {
          throw new Error('SignatureDoesNotMatch: missing CRLF after chunk data');
        }
        this.buffer = this.buffer.slice(2);
        if (this.sawTerminator) {
          this.state = 'DONE';
          return;
        }
        this.state = 'HEADER';
      } else {
        return;
      }
    }
  }

  private verifyHash(payloadHashHex: string): void {
    const sts = [
      'AWS4-HMAC-SHA256-PAYLOAD',
      this.datetime,
      this.scope,
      this.prevSig,
      ChunkSignatureV4Parser.EMPTY_SHA256,
      payloadHashHex,
    ].join('\n');
    const sig = crypto.createHmac('sha256', this.signingKey).update(sts).digest('hex');
    if (
      sig.length !== this.declaredChunkSig.length ||
      !crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(this.declaredChunkSig, 'hex'))
    ) {
      throw new Error('SignatureDoesNotMatch: chunk signature invalid');
    }
    this.prevSig = sig;
  }
}
