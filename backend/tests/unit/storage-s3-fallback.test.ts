import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3StorageProvider } from '../../src/providers/storage/s3.provider.ts';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

function asyncIterableFromString(s: string): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(s);
    },
  };
}

function notFoundError(name = 'NoSuchKey') {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
}

describe('S3StorageProvider — branch fallback', () => {
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(
      sendMock as unknown as typeof S3Client.prototype.send
    );
  });

  function makeProvider(parentAppKey?: string): S3StorageProvider {
    const p = new S3StorageProvider('bucket', 'branchkey', 'us-east-2', parentAppKey);
    // Inject a real client without going through env-driven initialize().
    (p as unknown as { s3Client: S3Client }).s3Client = new S3Client({ region: 'us-east-2' });
    return p;
  }

  describe('getObject', () => {
    it('returns branch object on first hit (no parent call)', async () => {
      sendMock.mockResolvedValueOnce({ Body: asyncIterableFromString('hello') });
      const p = makeProvider('parentkey');
      const out = await p.getObject('photos', 'a.txt');
      expect(out?.toString()).toBe('hello');
      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0][0] as GetObjectCommand;
      expect(cmd.input.Key).toBe('branchkey/photos/a.txt');
    });

    it('falls back to parent on NoSuchKey', async () => {
      sendMock
        .mockRejectedValueOnce(notFoundError('NoSuchKey'))
        .mockResolvedValueOnce({ Body: asyncIterableFromString('parent-data') });
      const p = makeProvider('parentkey');
      const out = await p.getObject('photos', 'a.txt');
      expect(out?.toString()).toBe('parent-data');
      const k1 = (sendMock.mock.calls[0][0] as GetObjectCommand).input.Key;
      const k2 = (sendMock.mock.calls[1][0] as GetObjectCommand).input.Key;
      expect(k1).toBe('branchkey/photos/a.txt');
      expect(k2).toBe('parentkey/photos/a.txt');
    });

    it('returns null when both branch and parent miss', async () => {
      sendMock
        .mockRejectedValueOnce(notFoundError())
        .mockRejectedValueOnce(notFoundError());
      const p = makeProvider('parentkey');
      expect(await p.getObject('photos', 'a.txt')).toBeNull();
    });

    it('does NOT fall back when no parent configured', async () => {
      sendMock.mockRejectedValueOnce(notFoundError());
      const p = makeProvider();  // no parentAppKey
      expect(await p.getObject('photos', 'a.txt')).toBeNull();
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('headObject', () => {
    it('returns branch metadata on first hit', async () => {
      sendMock.mockResolvedValueOnce({
        ContentLength: 42,
        ETag: '"abc"',
        ContentType: 'text/plain',
        LastModified: new Date('2026-04-29'),
      });
      const p = makeProvider('parentkey');
      const meta = await p.headObject('photos', 'a.txt');
      expect(meta?.size).toBe(42);
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to parent on NotFound', async () => {
      sendMock
        .mockRejectedValueOnce(notFoundError('NotFound'))
        .mockResolvedValueOnce({ ContentLength: 7, ETag: '"p"', LastModified: new Date() });
      const p = makeProvider('parentkey');
      const meta = await p.headObject('photos', 'a.txt');
      expect(meta?.size).toBe(7);
      expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it('rethrows non-404 errors instead of falling back', async () => {
      sendMock.mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'AccessDenied' }));
      const p = makeProvider('parentkey');
      await expect(p.headObject('photos', 'a.txt')).rejects.toThrow();
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getObjectStream', () => {
    function fakeStreamResponse(body: string) {
      return {
        Body: Readable.from([Buffer.from(body)]),
        ContentLength: body.length,
        ETag: '"x"',
        ContentType: 'text/plain',
        LastModified: new Date(),
      };
    }

    it('streams from parent when branch is 404', async () => {
      sendMock
        .mockRejectedValueOnce(notFoundError())
        .mockResolvedValueOnce(fakeStreamResponse('parent-stream'));
      const p = makeProvider('parentkey');
      const out = await p.getObjectStream('photos', 'a.txt');
      const chunks: Buffer[] = [];
      for await (const c of out.body) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).toString()).toBe('parent-stream');
    });

    it('throws when both branch and parent miss', async () => {
      sendMock
        .mockRejectedValueOnce(notFoundError())
        .mockRejectedValueOnce(notFoundError());
      const p = makeProvider('parentkey');
      await expect(p.getObjectStream('photos', 'a.txt')).rejects.toThrow();
    });
  });

  describe('getDownloadStrategy presigned URL', () => {
    beforeEach(() => {
      delete process.env.AWS_CLOUDFRONT_URL;
    });

    it('signs branch key when branch HEAD succeeds', async () => {
      sendMock.mockResolvedValueOnce({ ContentLength: 5, LastModified: new Date(), ETag: '"x"' });
      const p = makeProvider('parentkey');
      const strategy = await p.getDownloadStrategy('photos', 'a.txt');
      expect(strategy.method).toBe('presigned');
      expect(strategy.url).toContain('branchkey/photos/a.txt');
    });

    it('signs parent key when branch HEAD returns 404', async () => {
      // First call = branch HEAD → 404.
      sendMock.mockRejectedValueOnce(notFoundError('NotFound'));
      const p = makeProvider('parentkey');
      const strategy = await p.getDownloadStrategy('photos', 'a.txt');
      expect(strategy.url).toContain('parentkey/photos/a.txt');
    });

    it('non-branch project: no HEAD round-trip, signs branch key directly', async () => {
      const p = makeProvider();  // no parentAppKey
      const strategy = await p.getDownloadStrategy('photos', 'a.txt');
      expect(strategy.url).toContain('branchkey/photos/a.txt');
      // No HEAD call should have happened.
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});
