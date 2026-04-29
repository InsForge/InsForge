/**
 * Covers the min-chunk coalescing Transform used between the aws-chunked
 * parsers and the AWS SDK client. The parsers emit whatever TCP fragment
 * arrives, which is often <8 KiB — real S3 / MinIO reject non-final
 * streaming chunks that small. The coalescer guarantees ≥minBytes writes
 * with one smaller flush at end-of-stream.
 *
 * It lives inline in put-object.ts and upload-part.ts so we don't export
 * it from a shared module; the test below inlines a copy to lock the
 * contract down.
 */
import { describe, it, expect } from 'vitest';
import { Readable, Transform, TransformCallback } from 'stream';

class MinChunkSizeStream extends Transform {
  private pending: Buffer[] = [];
  private pendingLen = 0;
  constructor(private readonly minBytes: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.pending.push(chunk);
    this.pendingLen += chunk.length;
    if (this.pendingLen >= this.minBytes) {
      this.push(Buffer.concat(this.pending, this.pendingLen));
      this.pending = [];
      this.pendingLen = 0;
    }
    cb();
  }
  _flush(cb: TransformCallback): void {
    if (this.pendingLen > 0) {
      this.push(Buffer.concat(this.pending, this.pendingLen));
      this.pending = [];
      this.pendingLen = 0;
    }
    cb();
  }
}

async function pipeAndCollect(
  inputs: Buffer[],
  minBytes: number
): Promise<{ chunks: Buffer[]; combined: Buffer }> {
  const stream = new MinChunkSizeStream(minBytes);
  Readable.from(inputs).pipe(stream);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return { chunks, combined: Buffer.concat(chunks) };
}

describe('MinChunkSizeStream', () => {
  it('coalesces small writes into ≥minBytes emissions', async () => {
    const small = Array.from({ length: 100 }, () => Buffer.alloc(100, 0x61));
    const { chunks, combined } = await pipeAndCollect(small, 8192);

    // All emissions before the last must be ≥minBytes; only the final
    // flush is allowed to be smaller.
    for (let i = 0; i < chunks.length - 1; i++) {
      expect(chunks[i].length).toBeGreaterThanOrEqual(8192);
    }
    expect(combined.length).toBe(10000);
  });

  it('passes a single large buffer through untouched', async () => {
    const big = Buffer.alloc(100_000, 0x7a);
    const { chunks, combined } = await pipeAndCollect([big], 65536);
    expect(chunks).toHaveLength(1);
    expect(combined.equals(big)).toBe(true);
  });

  it('flushes any remaining bytes on stream end (final chunk may be <minBytes)', async () => {
    const inputs = [Buffer.alloc(5000, 0x31), Buffer.alloc(5000, 0x32)]; // 10000 < 65536
    const { chunks, combined } = await pipeAndCollect(inputs, 65536);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(10000);
    expect(combined[0]).toBe(0x31);
    expect(combined[combined.length - 1]).toBe(0x32);
  });

  it('preserves byte order across coalesced emissions', async () => {
    // 4 writes of 25_000 bytes each = 100 KiB; coalesced at 65 KiB threshold
    const a = Buffer.alloc(25_000, 0xa);
    const b = Buffer.alloc(25_000, 0xb);
    const c = Buffer.alloc(25_000, 0xc);
    const d = Buffer.alloc(25_000, 0xd);
    const { combined } = await pipeAndCollect([a, b, c, d], 65536);
    expect(combined.length).toBe(100_000);
    expect(combined.slice(0, 25_000).every((v) => v === 0xa)).toBe(true);
    expect(combined.slice(25_000, 50_000).every((v) => v === 0xb)).toBe(true);
    expect(combined.slice(50_000, 75_000).every((v) => v === 0xc)).toBe(true);
    expect(combined.slice(75_000).every((v) => v === 0xd)).toBe(true);
  });

  it('emits nothing when input is empty', async () => {
    const { chunks, combined } = await pipeAndCollect([], 8192);
    expect(chunks).toHaveLength(0);
    expect(combined.length).toBe(0);
  });
});
