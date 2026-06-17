/**
 * S3 gateway CORS, tagging, and versioning integration test.
 *
 * Opt-in: set RUN_S3_GATEWAY_INTEGRATION=1 to run. Requires:
 *   - backend running at S3_GATEWAY_URL (default http://localhost:3000/storage/v1/s3)
 *   - S3_GATEWAY_AK and S3_GATEWAY_SK from a /api/storage/s3/access-keys create response
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  DeleteBucketCorsCommand,
  PutObjectCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand,
  DeleteObjectTaggingCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
  NoSuchBucket,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { S3ProtocolError } from '@/api/routes/s3-gateway/errors.js';

const INTEGRATION = process.env.RUN_S3_GATEWAY_INTEGRATION === '1';
const describeIf = INTEGRATION ? describe : describe.skip;

const clientConfig = {
  endpoint: process.env.S3_GATEWAY_URL || 'http://localhost:3000/storage/v1/s3',
  region: 'us-east-2',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_GATEWAY_AK as string,
    secretAccessKey: process.env.S3_GATEWAY_SK as string,
  },
};

describeIf('S3 gateway CORS (integration)', () => {
  let s3: S3Client;
  const bucket = `cors-${Date.now()}`;

  beforeAll(async () => {
    s3 = new S3Client(clientConfig);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
  });

  it('returns NoSuchCORSConfiguration when no rules are set', async () => {
    try {
      await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
      expect.unreachable('expected NoSuchCORSConfiguration');
    } catch (err: unknown) {
      const s3Err = err as { name: string; message: string };
      expect(s3Err.name).toBe('NoSuchCORSConfiguration');
    }
  });

  it('puts and gets CORS rules', async () => {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ['https://example.com'],
              AllowedMethods: ['GET', 'PUT'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['x-amz-request-id'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      })
    );

    const got = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    expect(got.CORSRules).toBeDefined();
    expect(got.CORSRules!.length).toBe(1);
    expect(got.CORSRules![0].AllowedOrigins).toContain('https://example.com');
    expect(got.CORSRules![0].AllowedMethods).toContain('GET');
    expect(got.CORSRules![0].MaxAgeSeconds).toBe(3600);
  });

  it('puts multiple CORS rules', async () => {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ['https://app.example.com'],
              AllowedMethods: ['GET'],
            },
            {
              AllowedOrigins: ['https://admin.example.com'],
              AllowedMethods: ['POST', 'PUT'],
              AllowedHeaders: ['Authorization'],
            },
          ],
        },
      })
    );

    const got = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    expect(got.CORSRules!.length).toBe(2);
  });

  it('deletes CORS rules', async () => {
    await s3.send(new DeleteBucketCorsCommand({ Bucket: bucket }));

    try {
      await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
      expect.unreachable('expected NoSuchCORSConfiguration after delete');
    } catch (err: unknown) {
      const s3Err = err as { name: string; message: string };
      expect(s3Err.name).toBe('NoSuchCORSConfiguration');
    }
  });
});

describeIf('S3 gateway object tagging (integration)', () => {
  let s3: S3Client;
  const bucket = `tag-${Date.now()}`;
  const key = 'tagged-file.txt';

  beforeAll(async () => {
    s3 = new S3Client(clientConfig);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from('hello'),
        ContentType: 'text/plain',
      })
    );
  });

  afterAll(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
  });

  it('returns empty tag set when no tags are set', async () => {
    const got = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    expect(got.TagSet).toEqual([]);
  });

  it('puts and gets tags', async () => {
    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: {
          TagSet: [
            { Key: 'env', Value: 'test' },
            { Key: 'owner', Value: 'ci' },
          ],
        },
      })
    );

    const got = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    expect(got.TagSet).toBeDefined();
    expect(got.TagSet!.length).toBe(2);

    const envTag = got.TagSet!.find((t) => t.Key === 'env');
    expect(envTag?.Value).toBe('test');

    const ownerTag = got.TagSet!.find((t) => t.Key === 'owner');
    expect(ownerTag?.Value).toBe('ci');
  });

  it('replaces tags on put', async () => {
    await s3.send(
      new PutObjectTaggingCommand({
        Bucket: bucket,
        Key: key,
        Tagging: {
          TagSet: [{ Key: 'stage', Value: 'prod' }],
        },
      })
    );

    const got = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    expect(got.TagSet!.length).toBe(1);
    expect(got.TagSet![0].Key).toBe('stage');
    expect(got.TagSet![0].Value).toBe('prod');
  });

  it('deletes tags', async () => {
    await s3.send(new DeleteObjectTaggingCommand({ Bucket: bucket, Key: key }));

    const got = await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
    expect(got.TagSet).toEqual([]);
  });

  it('throws NoSuchKey for tagging on nonexistent object', async () => {
    try {
      await s3.send(
        new PutObjectTaggingCommand({
          Bucket: bucket,
          Key: 'nonexistent',
          Tagging: { TagSet: [{ Key: 'k', Value: 'v' }] },
        })
      );
      expect.unreachable('expected NoSuchKey');
    } catch (err: unknown) {
      const s3Err = err as { name: string };
      expect(s3Err.name).toBe('NoSuchKey');
    }
  });
});

describeIf('S3 gateway versioning (integration)', () => {
  let s3: S3Client;
  const bucket = `ver-${Date.now()}`;

  beforeAll(async () => {
    s3 = new S3Client(clientConfig);
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
  });

  it('defaults to Disabled', async () => {
    const got = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    expect(got.Status).toBe('Disabled');
  });

  it('enables versioning', async () => {
    await s3.send(new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Enabled' },
    }));

    const got = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    expect(got.Status).toBe('Enabled');
  });

  it('suspends versioning', async () => {
    await s3.send(new PutBucketVersioningCommand({
      Bucket: bucket,
      VersioningConfiguration: { Status: 'Suspended' },
    }));

    const got = await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    expect(got.Status).toBe('Suspended');
  });

  it('rejects Disabled via PUT', async () => {
    try {
      await s3.send(
        new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: 'Disabled' },
        })
      );
      expect.unreachable('expected InvalidArgument for Disabled status');
    } catch (err: unknown) {
      const s3Err = err as { name: string };
      expect(s3Err.name).toBe('InvalidArgument');
    }
  });
});
