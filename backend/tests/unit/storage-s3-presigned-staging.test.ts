import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

import { S3StorageProvider } from '../../src/providers/storage/s3.provider.ts';

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: vi.fn(),
}));

vi.mock('@/infra/config/app.config.js', () => {
  const config = {
    cloud: {},
    storage: {},
    server: { logsDir: 'logs' },
    app: { logLevel: 'info' },
  };
  return { config, appConfig: config };
});

describe('S3StorageProvider presigned upload staging', () => {
  let sendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(
      sendMock as unknown as typeof S3Client.prototype.send
    );
  });

  function makeProvider(): S3StorageProvider {
    const provider = new S3StorageProvider('physical-bucket', 'app-key', 'us-east-2');
    (provider as unknown as { s3Client: S3Client }).s3Client = new S3Client({
      region: 'us-east-2',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    return provider;
  }

  it('presigns a random staging key instead of the final object key', async () => {
    vi.mocked(createPresignedPost).mockResolvedValue({
      url: 'https://s3.example.test/upload',
      fields: { key: 'placeholder' },
    });
    const provider = makeProvider();

    const strategy = await provider.getUploadStrategy(
      'photos',
      'alice/report.pdf',
      { contentType: 'application/pdf', size: 12 },
      1024,
      'application/pdf'
    );

    const presignInput = vi.mocked(createPresignedPost).mock.calls[0][1];
    expect(presignInput.Key).toMatch(/^app-key\/_uploads\/[0-9a-f-]{36}$/);
    expect(presignInput.Key).not.toContain('alice/report.pdf');

    const confirmUrl = new URL(strategy.confirmUrl!, 'https://api.example.test');
    const uploadId = confirmUrl.searchParams.get('uploadId');
    expect(uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(presignInput.Key).toBe(`app-key/_uploads/${uploadId}`);
    expect(strategy.key).toBe('alice/report.pdf');
  });

  it('heads the staged object and only promotes it when confirmation succeeds', async () => {
    const provider = makeProvider();
    const uploadId = '11111111-2222-4333-8444-555555555555';
    sendMock
      .mockResolvedValueOnce({ ContentLength: 12, ETag: '"staged-etag"' })
      .mockResolvedValueOnce({
        CopyObjectResult: { ETag: '"final-etag"', LastModified: new Date('2026-07-20') },
      })
      .mockResolvedValueOnce({});

    await expect(
      provider.verifyObjectExists('photos', 'alice/report.pdf', { stagedUploadId: uploadId })
    ).resolves.toEqual({ exists: true, size: 12, etag: 'staged-etag' });
    await expect(
      provider.finalizePresignedUpload('photos', 'alice/report.pdf', uploadId)
    ).resolves.toEqual({ etag: 'final-etag' });

    const head = sendMock.mock.calls[0][0] as HeadObjectCommand;
    const copy = sendMock.mock.calls[1][0] as CopyObjectCommand;
    const cleanup = sendMock.mock.calls[2][0] as DeleteObjectCommand;
    expect(head.input.Key).toBe(`app-key/_uploads/${uploadId}`);
    expect(copy.input).toMatchObject({
      Bucket: 'physical-bucket',
      Key: 'app-key/photos/alice/report.pdf',
      CopySource: `physical-bucket/app-key/_uploads/${uploadId}`,
    });
    expect(cleanup.input.Key).toBe(`app-key/_uploads/${uploadId}`);
  });
});
