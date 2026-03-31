import { beforeEach, describe, expect, it, vi } from 'vitest';

type CommandInput = {
  Bucket: string;
  Key: string;
  CopySource?: string;
};

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = sendMock;

    constructor(_config: Record<string, unknown>) {}
  }

  class MockCopyObjectCommand {
    constructor(public input: CommandInput) {}
  }

  class MockDeleteObjectCommand {
    constructor(public input: CommandInput) {}
  }

  class MockNoopCommand {
    constructor(public input?: CommandInput | Record<string, unknown>) {}
  }

  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockNoopCommand,
    GetObjectCommand: MockNoopCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    CopyObjectCommand: MockCopyObjectCommand,
    ListObjectsV2Command: MockNoopCommand,
    DeleteObjectsCommand: MockNoopCommand,
    HeadObjectCommand: MockNoopCommand,
  };
});

import { S3StorageProvider } from '../../src/providers/storage/s3.provider.ts';

describe('S3StorageProvider.renameObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({});
  });

  it('URL-encodes CopySource for keys with special characters', async () => {
    const provider = new S3StorageProvider('test-bucket', 'app-key');
    provider.initialize();

    await provider.renameObject('assets', 'folder/resume #2026.txt', 'folder/cover.txt');

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      input: {
        Bucket: 'test-bucket',
        CopySource: 'test-bucket/app-key/assets/folder/resume%20%232026.txt',
        Key: 'app-key/assets/folder/cover.txt',
      },
    });
    expect(sendMock.mock.calls[1][0]).toMatchObject({
      input: {
        Bucket: 'test-bucket',
        Key: 'app-key/assets/folder/resume #2026.txt',
      },
    });
  });
});
