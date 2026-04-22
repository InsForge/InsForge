import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { Readable } from 'stream';
import {
  ChunkSignatureV4Parser,
  deriveSigningKey,
} from '@/services/storage/s3-signature.js';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function signChunk(
  key: Buffer,
  datetime: string,
  scope: string,
  prev: string,
  payload: Buffer
): string {
  const empty = crypto.createHash('sha256').update('').digest('hex');
  const hashPayload = crypto.createHash('sha256').update(payload).digest('hex');
  const sts = ['AWS4-HMAC-SHA256-PAYLOAD', datetime, scope, prev, empty, hashPayload].join('\n');
  return crypto.createHmac('sha256', key).update(sts).digest('hex');
}

describe('ChunkSignatureV4Parser', () => {
  const secret = 's'.repeat(40);
  const date = '20260101';
  const datetime = '20260101T000000Z';
  const scope = `${date}/us-east-2/s3/aws4_request`;
  const signingKey = deriveSigningKey(secret, date, 'us-east-2', 's3');

  function makeChunkedBody(
    payload: Buffer,
    seedSignature: string,
    chunkSizes: number[]
  ): Buffer {
    const parts: Buffer[] = [];
    let prev = seedSignature;
    let offset = 0;
    for (const size of chunkSizes) {
      const slice = payload.slice(offset, offset + size);
      const sig = signChunk(signingKey, datetime, scope, prev, slice);
      parts.push(Buffer.from(`${slice.length.toString(16)};chunk-signature=${sig}\r\n`));
      parts.push(slice);
      parts.push(Buffer.from('\r\n'));
      prev = sig;
      offset += size;
    }
    const finalSig = signChunk(signingKey, datetime, scope, prev, Buffer.alloc(0));
    parts.push(Buffer.from(`0;chunk-signature=${finalSig}\r\n\r\n`));
    return Buffer.concat(parts);
  }

  it('emits verified payload bytes in order', async () => {
    const payload = Buffer.from('Hello, world! '.repeat(1000));
    const seedSig = 'a'.repeat(64);
    const buffer = makeChunkedBody(payload, seedSig, [500, 500, payload.length - 1000]);

    const parser = new ChunkSignatureV4Parser({
      seedSignature: seedSig,
      signingKey,
      datetime,
      scope,
    });
    Readable.from([buffer]).pipe(parser);
    const out = await collect(parser);
    expect(out.equals(payload)).toBe(true);
  });

  it('rejects a tampered payload byte', async () => {
    const payload = Buffer.from('a'.repeat(1024));
    const seedSig = 'a'.repeat(64);
    const buffer = makeChunkedBody(payload, seedSig, [1024]);
    const headerEnd = buffer.indexOf('\r\n') + 2;
    buffer[headerEnd + 10] ^= 1;

    const parser = new ChunkSignatureV4Parser({
      seedSignature: seedSig,
      signingKey,
      datetime,
      scope,
    });
    Readable.from([buffer]).pipe(parser);
    await expect(collect(parser)).rejects.toThrow(/SignatureDoesNotMatch/);
  });

  it('handles chunks split across multiple buffers', async () => {
    const payload = Buffer.from('a'.repeat(2048));
    const seedSig = 'a'.repeat(64);
    const buffer = makeChunkedBody(payload, seedSig, [1024, 1024]);
    const mid = Math.floor(buffer.length / 2);

    const parser = new ChunkSignatureV4Parser({
      seedSignature: seedSig,
      signingKey,
      datetime,
      scope,
    });
    Readable.from([buffer.slice(0, mid), buffer.slice(mid)]).pipe(parser);
    const out = await collect(parser);
    expect(out.equals(payload)).toBe(true);
  });

  it('rejects stream that ends before terminator chunk', async () => {
    const payload = Buffer.from('xyz'.repeat(10));
    const seedSig = 'a'.repeat(64);
    const full = makeChunkedBody(payload, seedSig, [payload.length]);
    // Truncate before the 0-length terminator
    const truncated = full.slice(0, full.indexOf(Buffer.from('0;chunk-signature=')));

    const parser = new ChunkSignatureV4Parser({
      seedSignature: seedSig,
      signingKey,
      datetime,
      scope,
    });
    Readable.from([truncated]).pipe(parser);
    await expect(collect(parser)).rejects.toThrow(/SignatureDoesNotMatch/);
  });

  it('handles single-byte-at-a-time feeding', async () => {
    const payload = Buffer.from('abcdefgh');
    const seedSig = 'a'.repeat(64);
    const buffer = makeChunkedBody(payload, seedSig, [payload.length]);
    const byByte = Array.from({ length: buffer.length }, (_, i) => buffer.slice(i, i + 1));

    const parser = new ChunkSignatureV4Parser({
      seedSignature: seedSig,
      signingKey,
      datetime,
      scope,
    });
    Readable.from(byByte).pipe(parser);
    const out = await collect(parser);
    expect(out.equals(payload)).toBe(true);
  });
});
