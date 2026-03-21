import { LocalStorageProvider } from '../../src/providers/storage/local.provider.ts';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('LocalStorageProvider - deleteBucket', () => {
  const baseDir = path.join(__dirname, 'test-storage');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
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
      .mockRejectedValue({ code: 'EACCES' });

    await expect(provider.deleteBucket(bucket)).rejects.toEqual({
      code: 'EACCES',
    });

    spy.mockRestore();
  });
});