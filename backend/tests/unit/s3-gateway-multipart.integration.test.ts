/**
 * S3 gateway multipart-upload integration test.
 *
 * Opt-in: set RUN_S3_GATEWAY_INTEGRATION=1. See s3-gateway-crud.integration.test.ts
 * for the rest of the required environment.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const INTEGRATION = process.env.RUN_S3_GATEWAY_INTEGRATION === '1';
const describeIf = INTEGRATION ? describe : describe.skip;

describeIf('S3 gateway multipart (integration)', () => {
  let s3: S3Client;
  const bucket = `mpu-${Date.now()}`;

  beforeAll(async () => {
    s3 = new S3Client({
      endpoint: process.env.S3_GATEWAY_URL || 'http://localhost:3000/storage/v1/s3',
      region: 'us-east-2',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_GATEWAY_AK as string,
        secretAccessKey: process.env.S3_GATEWAY_SK as string,
      },
    });
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'big' })).catch(() => {});
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
  });

  it('uploads a 25 MB object via multipart and round-trips it', async () => {
    const size = 25 * 1024 * 1024;
    const body = crypto.randomBytes(size);
    const bodyDigest = crypto.createHash('sha256').update(body).digest('hex');

    const u = new Upload({
      client: s3,
      params: { Bucket: bucket, Key: 'big', Body: body },
      partSize: 5 * 1024 * 1024,
      queueSize: 4,
    });
    await u.done();

    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'big' }));
    const chunks: Buffer[] = [];
    for await (const c of got.Body as AsyncIterable<Buffer>) chunks.push(c);
    const downloaded = Buffer.concat(chunks);
    const downloadedDigest = crypto.createHash('sha256').update(downloaded).digest('hex');

    expect(downloaded.length).toBe(size);
    expect(downloadedDigest).toBe(bodyDigest);
  }, 60_000);
});
