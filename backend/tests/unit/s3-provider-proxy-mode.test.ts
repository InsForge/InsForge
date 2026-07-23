import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { S3StorageProvider } from '../../src/providers/storage/s3.provider.ts';
import { S3Client } from '@aws-sdk/client-s3';

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    cloud: {
      get cloudFrontUrl() {
        return process.env.AWS_CLOUDFRONT_URL;
      },
      get cloudFrontKeyPairId() {
        return process.env.AWS_CLOUDFRONT_KEY_PAIR_ID;
      },
      get cloudFrontPrivateKey() {
        return process.env.AWS_CLOUDFRONT_PRIVATE_KEY;
      },
    },
    storage: {
      get s3EndpointUrl() {
        return process.env.S3_ENDPOINT_URL;
      },
      get s3PresignedUrls() {
        return process.env.S3_PRESIGNED_URLS !== 'false';
      },
    },
    server: {
      logsDir: 'logs',
    },
    app: {
      logLevel: 'info',
    },
  };
  return { config: c, appConfig: c };
});

vi.mock('@/utils/environment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/environment.js')>()),
  getApiBaseUrl: () => 'http://api.example.test',
}));

describe('S3StorageProvider — proxy mode (S3_PRESIGNED_URLS=false)', () => {
  let sendMock: ReturnType<typeof vi.fn>;
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'S3_PRESIGNED_URLS',
    'S3_ENDPOINT_URL',
    'AWS_CLOUDFRONT_URL',
    'AWS_CLOUDFRONT_KEY_PAIR_ID',
    'AWS_CLOUDFRONT_PRIVATE_KEY',
  ];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    sendMock = vi.fn();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(
      sendMock as unknown as typeof S3Client.prototype.send
    );
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  function makeProvider(parentAppKey?: string): S3StorageProvider {
    const p = new S3StorageProvider('bucket', 'appkey', 'us-east-2', parentAppKey);
    // Inject a real client with dummy creds so presigned-path tests can sign
    // locally without the SDK credential provider chain.
    (p as unknown as { s3Client: S3Client }).s3Client = new S3Client({
      region: 'us-east-2',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    return p;
  }

  describe('flag default (presigned)', () => {
    it('supportsPresignedUrls() is true', () => {
      expect(makeProvider().supportsPresignedUrls()).toBe(true);
    });

    it('upload strategy is presigned POST with confirm step', async () => {
      const strategy = await makeProvider().getUploadStrategy('photos', 'a.txt', {}, 1024);
      expect(strategy.method).toBe('presigned');
      expect(strategy.confirmRequired).toBe(true);
      expect(strategy.fields).toBeDefined();
    });

    it('download strategy is presigned', async () => {
      const strategy = await makeProvider().getDownloadStrategy('photos', 'a.txt');
      expect(strategy.method).toBe('presigned');
      expect(strategy.url).toContain('X-Amz-Signature');
    });
  });

  describe('flag off (proxy mode)', () => {
    beforeEach(() => {
      process.env.S3_PRESIGNED_URLS = 'false';
    });

    it('supportsPresignedUrls() is false', () => {
      expect(makeProvider().supportsPresignedUrls()).toBe(false);
    });

    it('upload strategy is a direct backend PUT with no confirm step', async () => {
      const strategy = await makeProvider().getUploadStrategy('photos', 'a b.txt', {}, 1024);
      expect(strategy).toEqual({
        method: 'direct',
        uploadUrl: 'http://api.example.test/api/storage/buckets/photos/objects/a%20b.txt',
        key: 'a b.txt',
        confirmRequired: false,
      });
      // No presigned POST — nothing was sent to S3.
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('download strategy is a direct backend URL with ?v= cache stamp', async () => {
      const strategy = await makeProvider().getDownloadStrategy(
        'photos',
        'a b.txt',
        3600,
        false,
        'etag&1'
      );
      expect(strategy).toEqual({
        method: 'direct',
        url: 'http://api.example.test/api/storage/buckets/photos/objects/a%20b.txt?v=etag%261',
      });
    });

    it('download strategy omits ?v= when no version is supplied', async () => {
      const strategy = await makeProvider().getDownloadStrategy('photos', 'a.txt');
      expect(strategy.url).toBe('http://api.example.test/api/storage/buckets/photos/objects/a.txt');
    });

    it('branch mode: no HEAD probe — the backend GET route resolves fallback itself', async () => {
      const strategy = await makeProvider('parentkey').getDownloadStrategy('photos', 'a.txt');
      expect(strategy.method).toBe('direct');
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('CloudFront settings are ignored in proxy mode', async () => {
      process.env.AWS_CLOUDFRONT_URL = 'https://cdn.example.test';
      process.env.AWS_CLOUDFRONT_KEY_PAIR_ID = 'K123TEST';
      process.env.AWS_CLOUDFRONT_PRIVATE_KEY = 'irrelevant';
      const strategy = await makeProvider().getDownloadStrategy('photos', 'a.txt');
      expect(strategy.method).toBe('direct');
      expect(strategy.url).toContain('http://api.example.test/');
    });
  });
});
