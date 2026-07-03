import { LocalStorageProvider } from '../../src/providers/storage/local.provider.ts';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    rm: vi.fn(actual.rm),
    unlink: vi.fn(actual.unlink),
  };
});

describe('LocalStorageProvider - deleteBucket', () => {
  const baseDir = path.join(__dirname, 'test-storage');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('deletes an existing bucket', async () => {
    const bucket = 'testBucket';
    const bucketPath = path.join(baseDir, bucket);

    await fs.mkdir(bucketPath, { recursive: true });

    await provider.deleteBucket(bucket);

    await expect(fs.access(bucketPath)).rejects.toThrow();
  });

  it('does not throw if bucket does not exist (ENOENT)', async () => {
    await expect(provider.deleteBucket('nonExistentBucket')).resolves.toBeUndefined();
  });

  it('rethrows unexpected fs errors', async () => {
    const bucket = 'testBucket';

    const spy = vi.spyOn(fs, 'rm').mockRejectedValue({ code: 'EACCES' } as NodeJS.ErrnoException);

    await expect(provider.deleteBucket(bucket)).rejects.toEqual({
      code: 'EACCES',
    });

    spy.mockRestore();
  });

  it('throws for empty bucket name', async () => {
    await expect(provider.deleteBucket('')).rejects.toThrow('Invalid bucket name');
  });

  it('throws for whitespace-only bucket name', async () => {
    await expect(provider.deleteBucket('   ')).rejects.toThrow('Invalid bucket name');
  });

  it('throws for bucket name with invalid characters', async () => {
    await expect(provider.deleteBucket('.')).rejects.toThrow(
      'Bucket name contains invalid characters'
    );

    await expect(provider.deleteBucket('..')).rejects.toThrow(
      'Bucket name contains invalid characters'
    );

    await expect(provider.deleteBucket('foo/bar')).rejects.toThrow(
      'Bucket name contains invalid characters'
    );
  });
});

describe('LocalStorageProvider - putObject etag', () => {
  const baseDir = path.join(__dirname, 'test-storage-etag');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
    await provider.createBucket('etagBucket');
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeFile(buffer: Buffer): Express.Multer.File {
    return {
      buffer,
      mimetype: 'application/octet-stream',
      originalname: 'x.bin',
      size: buffer.length,
      fieldname: 'file',
      encoding: '7bit',
      stream: undefined as never,
      destination: '',
      filename: '',
      path: '',
    } as Express.Multer.File;
  }

  it('returns an md5 etag for stored bytes', async () => {
    const file = makeFile(Buffer.from('hello world'));
    const { etag } = await provider.putObject('etagBucket', 'key1', file);
    // md5('hello world')
    expect(etag).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('returns the same etag when the same bytes are written again', async () => {
    const a = await provider.putObject('etagBucket', 'k', makeFile(Buffer.from('same')));
    const b = await provider.putObject('etagBucket', 'k', makeFile(Buffer.from('same')));
    expect(a.etag).toBe(b.etag);
  });

  it('returns a different etag when bytes change', async () => {
    const a = await provider.putObject('etagBucket', 'k', makeFile(Buffer.from('v1')));
    const b = await provider.putObject('etagBucket', 'k', makeFile(Buffer.from('v2')));
    expect(a.etag).not.toBe(b.etag);
  });
});

describe('LocalStorageProvider - deleteObjects', () => {
  const baseDir = path.join(__dirname, 'test-storage-delete-objects');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
    await provider.createBucket('batchBucket');
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('deletes multiple files and ignores missing files', async () => {
    await fs.mkdir(path.join(baseDir, 'batchBucket', 'folder'), { recursive: true });
    await fs.writeFile(path.join(baseDir, 'batchBucket', 'a.txt'), 'a');
    await fs.writeFile(path.join(baseDir, 'batchBucket', 'folder', 'b.txt'), 'b');

    const result = await provider.deleteObjects('batchBucket', [
      'a.txt',
      'folder/b.txt',
      'missing.txt',
    ]);

    expect(result).toEqual({
      deleted: ['a.txt', 'folder/b.txt', 'missing.txt'],
      failed: [],
    });
    await expect(fs.access(path.join(baseDir, 'batchBucket', 'a.txt'))).rejects.toThrow();
    await expect(fs.access(path.join(baseDir, 'batchBucket', 'folder', 'b.txt'))).rejects.toThrow();
  });

  it('reports unexpected unlink failures per key', async () => {
    vi.spyOn(fs, 'unlink').mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' })
    );

    const result = await provider.deleteObjects('batchBucket', ['blocked.txt']);

    expect(result).toEqual({
      deleted: [],
      failed: [{ key: 'blocked.txt', message: 'Failed to delete object' }],
    });
  });
});

describe('LocalStorageProvider - getDownloadStrategy versioning', () => {
  const baseDir = path.join(__dirname, 'test-storage-dl');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
    process.env.API_BASE_URL = 'https://app.test';
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    delete process.env.API_BASE_URL;
    vi.restoreAllMocks();
  });

  it('omits ?v= when no version is supplied', async () => {
    const s = await provider.getDownloadStrategy('b', 'k.png');
    expect(s.url).toBe('https://app.test/api/storage/buckets/b/objects/k.png');
  });

  it('appends ?v=<version> when a version is supplied', async () => {
    const s = await provider.getDownloadStrategy('b', 'k.png', 0, true, 'abc123');
    expect(s.url).toBe('https://app.test/api/storage/buckets/b/objects/k.png?v=abc123');
  });

  it('url-encodes the version stamp', async () => {
    const s = await provider.getDownloadStrategy('b', 'k.png', 0, true, 'a b&c');
    expect(s.url).toBe('https://app.test/api/storage/buckets/b/objects/k.png?v=a%20b%26c');
  });
});
