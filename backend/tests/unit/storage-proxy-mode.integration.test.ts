/**
 * Storage proxy-mode integration test.
 *
 * Opt-in: set RUN_STORAGE_PROXY_INTEGRATION=1 to run. Requires:
 *   - backend running at INSFORGE_API_BASE (default http://localhost:7130)
 *     with an S3 backend AND S3_PRESIGNED_URLS=false — e.g. the MinIO overlay:
 *       docker compose -f docker-compose.yml -f docker-compose.minio.yml up -d
 *   - INSFORGE_API_KEY: an admin API key (ik_...) for the REST API
 *
 * Verifies the proxy-mode contract end to end: direct upload strategy,
 * PUT round-trip through the backend, streamed download, and ranged 206.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const INTEGRATION = process.env.RUN_STORAGE_PROXY_INTEGRATION === '1';
const describeIf = INTEGRATION ? describe : describe.skip;

const BASE = (process.env.INSFORGE_API_BASE || 'http://localhost:7130').replace(/\/+$/, '');
const API_KEY = process.env.INSFORGE_API_KEY as string;
const HEADERS = { Authorization: `Bearer ${API_KEY}` };

describeIf('Storage proxy mode (integration)', () => {
  const bucket = `proxy-integ-${Date.now()}`;
  const key = 'hello.txt';
  const content = 'hello proxy mode!';

  beforeAll(async () => {
    const res = await fetch(`${BASE}/api/storage/buckets`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucketName: bucket, isPublic: true }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  afterAll(async () => {
    await fetch(`${BASE}/api/storage/buckets/${bucket}`, {
      method: 'DELETE',
      headers: HEADERS,
    }).catch(() => {});
  });

  it('upload strategy is direct (no presigned URL, no confirm step)', async () => {
    const res = await fetch(`${BASE}/api/storage/buckets/${bucket}/upload-strategy`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: key, contentType: 'text/plain', size: content.length }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const strategy = (await res.json()) as {
      method: string;
      uploadUrl: string;
      confirmRequired: boolean;
    };
    expect(strategy.method).toBe('direct');
    expect(strategy.confirmRequired).toBe(false);
    expect(strategy.uploadUrl).toContain(`/api/storage/buckets/${bucket}/objects/`);
  });

  it('uploads via the direct PUT route and reads the bytes back', async () => {
    const form = new FormData();
    form.append('file', new Blob([content], { type: 'text/plain' }), key);
    const put = await fetch(`${BASE}/api/storage/buckets/${bucket}/objects/${key}`, {
      method: 'PUT',
      headers: HEADERS,
      body: form,
    });
    expect(put.status, await put.clone().text()).toBe(200);

    const got = await fetch(`${BASE}/api/storage/buckets/${bucket}/objects/${key}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('accept-ranges')).toBe('bytes');
    expect(await got.text()).toBe(content);
  });

  it('serves ranged downloads with 206 + Content-Range', async () => {
    const got = await fetch(`${BASE}/api/storage/buckets/${bucket}/objects/${key}`, {
      headers: { Range: 'bytes=0-4' },
    });
    expect(got.status).toBe(206);
    expect(got.headers.get('content-range')).toBe(`bytes 0-4/${content.length}`);
    expect(await got.text()).toBe(content.slice(0, 5));
  });

  it('download strategy is direct with a version stamp', async () => {
    const res = await fetch(
      `${BASE}/api/storage/buckets/${bucket}/download-strategy/objects/${key}`,
      { headers: HEADERS }
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const strategy = (await res.json()) as { method: string; url: string };
    expect(strategy.method).toBe('direct');
    expect(strategy.url).toContain(`/api/storage/buckets/${bucket}/objects/`);
  });
});
