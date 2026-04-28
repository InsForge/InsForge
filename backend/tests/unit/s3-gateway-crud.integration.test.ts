/**
 * S3 gateway CRUD integration test.
 *
 * Opt-in: set RUN_S3_GATEWAY_INTEGRATION=1 to run. Requires:
 *   - backend running at S3_GATEWAY_URL (default http://localhost:3000/storage/v1/s3)
 *     with a real S3 backend (MinIO via docker-compose.minio.yml is fine)
 *   - S3_GATEWAY_AK and S3_GATEWAY_SK from a /api/storage/s3/access-keys create response
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';

const INTEGRATION = process.env.RUN_S3_GATEWAY_INTEGRATION === '1';
const describeIf = INTEGRATION ? describe : describe.skip;

describeIf('S3 gateway CRUD (integration)', () => {
  let s3: S3Client;
  const bucket = `integ-${Date.now()}`;

  beforeAll(() => {
    s3 = new S3Client({
      endpoint: process.env.S3_GATEWAY_URL || 'http://localhost:3000/storage/v1/s3',
      region: 'us-east-2',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_GATEWAY_AK as string,
        secretAccessKey: process.env.S3_GATEWAY_SK as string,
      },
    });
  });

  afterAll(async () => {
    // Best-effort cleanup
    await s3.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => {});
  });

  it('creates a bucket', async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  it('puts, heads, gets, lists, deletes an object', async () => {
    const body = Buffer.from('hello s3 gateway');
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'k1',
        Body: body,
        ContentType: 'text/plain',
      })
    );

    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: 'k1' }));
    expect(Number(head.ContentLength)).toBe(body.length);

    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: 'k1' }));
    const chunks: Buffer[] = [];
    for await (const c of got.Body as AsyncIterable<Buffer>) chunks.push(c);
    expect(Buffer.concat(chunks).equals(body)).toBe(true);

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(listed.Contents?.some((o) => o.Key === 'k1')).toBe(true);

    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: 'k1' }));

    const after = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    expect(after.Contents?.some((o) => o.Key === 'k1')).toBeFalsy();
  });

  it('deletes the bucket', async () => {
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  });
});
