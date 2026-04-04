import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import * as path from 'path';
import { LocalStorageProvider } from '../../src/providers/storage/local.provider.ts';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    copyFile: vi.fn(actual.copyFile),
    mkdir: vi.fn(actual.mkdir),
  };
});

describe('LocalStorageProvider.copyObject', () => {
  const baseDir = path.join(__dirname, 'test-storage-copy');
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    provider = new LocalStorageProvider(baseDir);
    await provider.initialize();
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('copies file to new location', async () => {
    const bucket = 'test-bucket';
    const bucketPath = path.join(baseDir, bucket);
    await fs.mkdir(bucketPath, { recursive: true });

    // Create source file
    const srcPath = path.join(bucketPath, 'source.txt');
    await fs.writeFile(srcPath, 'hello world');

    await provider.copyObject(bucket, 'source.txt', 'dest.txt');

    const destPath = path.join(bucketPath, 'dest.txt');
    const content = await fs.readFile(destPath, 'utf-8');
    expect(content).toBe('hello world');

    // Source should still exist
    const srcContent = await fs.readFile(srcPath, 'utf-8');
    expect(srcContent).toBe('hello world');
  });

  it('creates parent directories if needed', async () => {
    const bucket = 'test-bucket';
    const bucketPath = path.join(baseDir, bucket);
    await fs.mkdir(bucketPath, { recursive: true });

    // Create source file
    await fs.writeFile(path.join(bucketPath, 'source.txt'), 'nested test');

    await provider.copyObject(bucket, 'source.txt', 'subdir/nested/dest.txt');

    const destPath = path.join(bucketPath, 'subdir', 'nested', 'dest.txt');
    const content = await fs.readFile(destPath, 'utf-8');
    expect(content).toBe('nested test');
  });

  it('throws when source file does not exist', async () => {
    const bucket = 'test-bucket';
    await fs.mkdir(path.join(baseDir, bucket), { recursive: true });

    await expect(
      provider.copyObject(bucket, 'nonexistent.txt', 'dest.txt')
    ).rejects.toThrow();
  });
});

describe('S3StorageProvider.copyObject', () => {
  it('calls CopyObjectCommand with correct params', async () => {
    const mockSend = vi.fn().mockResolvedValue({});

    vi.doMock('@aws-sdk/client-s3', () => ({
      S3Client: vi.fn().mockImplementation(() => ({
        send: mockSend,
      })),
      CopyObjectCommand: vi.fn().mockImplementation((params) => ({
        ...params,
        _type: 'CopyObjectCommand',
      })),
      PutObjectCommand: vi.fn(),
      GetObjectCommand: vi.fn(),
      DeleteObjectCommand: vi.fn(),
      HeadObjectCommand: vi.fn(),
      ListObjectsV2Command: vi.fn(),
      CreateBucketCommand: vi.fn(),
      DeleteBucketCommand: vi.fn(),
    }));

    // Dynamic import after mocking
    const { S3StorageProvider } = await import('../../src/providers/storage/s3.provider.ts');
    const provider = new S3StorageProvider('my-s3-bucket', 'app-key', 'us-east-1');
    provider.initialize();

    await provider.copyObject('user-bucket', 'old-file.txt', 'new-file.txt');

    expect(mockSend).toHaveBeenCalledTimes(1);
    // CopyObjectCommand is constructed with the right params
    const { CopyObjectCommand: MockedCmd } = await import('@aws-sdk/client-s3');
    expect(MockedCmd).toHaveBeenCalledWith({
      Bucket: 'my-s3-bucket',
      CopySource: 'my-s3-bucket/app-key/user-bucket/old-file.txt',
      Key: 'app-key/user-bucket/new-file.txt',
    });
  });
});
