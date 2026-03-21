import { LocalStorageProvider } from '../../src/providers/storage/local.provider.ts';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    rm: vi.fn(actual.rm),
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
    await expect(
      provider.deleteBucket('nonExistentBucket')
    ).resolves.toBeUndefined();
  });

  it('rethrows unexpected fs errors', async () => {
    const bucket = 'testBucket';

    const spy = vi
      .spyOn(fs, 'rm')
      .mockRejectedValue({ code: 'EACCES' } as NodeJS.ErrnoException);

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