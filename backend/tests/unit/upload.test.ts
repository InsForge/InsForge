import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = {
    server: {
      get maxFileSize() {
        const val = process.env.MAX_FILE_SIZE;
        if (!val) return undefined;
        const parsed = parseInt(val, 10);
        return isNaN(parsed) ? undefined : parsed;
      },
      maxFilesPerField: 10,
      logsDir: 'logs',
    },
    app: {
      logLevel: 'info',
    },
  };
  return { config: c, appConfig: c };
});

import { Readable } from 'node:stream';

import {
  getMaxFileSize,
  upload,
  dynamicUploadSingle,
} from '../../src/api/middlewares/upload';

const DEFAULT_50MB = 50 * 1024 * 1024;

describe('getMaxFileSize', () => {
  const originalEnv = process.env.MAX_FILE_SIZE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAX_FILE_SIZE;
    } else {
      process.env.MAX_FILE_SIZE = originalEnv;
    }
  });

  it('returns 50MB default when env var is not set', () => {
    delete process.env.MAX_FILE_SIZE;
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });

  it('returns 50MB default when env var is empty string', () => {
    process.env.MAX_FILE_SIZE = '';
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });

  it('returns custom value when env var is set', () => {
    process.env.MAX_FILE_SIZE = '10485760'; // 10MB
    expect(getMaxFileSize()).toBe(10485760);
  });

  it('returns default for non-numeric env var', () => {
    process.env.MAX_FILE_SIZE = 'not-a-number';
    expect(getMaxFileSize()).toBe(DEFAULT_50MB);
  });
});

/**
 * Regression test for GHSA-535w-7cp7-47q4 (CVE-2026-77037).
 *
 * Upgrading multer to 2.3.0 is necessary but NOT sufficient: the array-index
 * guard in make-middleware.js only runs when `fieldArrayIndexLimit` is an own
 * property of `limits`, and the documented default is Infinity. This test
 * proves the limit is actually configured on our uploaders rather than that
 * the dependency was merely bumped -- the exact gap that made the first cut
 * of this fix incomplete.
 */
describe('multer fieldArrayIndexLimit (GHSA-535w-7cp7-47q4)', () => {
  const BOUNDARY = '----insforgeUploadTestBoundary';

  // Minimal multipart body carrying a single text field.
  const multipartReq = (fieldName: string) => {
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"\r\n\r\n` +
        `x\r\n` +
        `--${BOUNDARY}--\r\n`,
      'utf8'
    );
    const req = Readable.from([body]) as Readable & { headers: Record<string, string> };
    req.headers = {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(body.length),
    };
    return req;
  };

  const run = (fieldName: string): Promise<unknown> =>
    new Promise((resolve) => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      upload.none()(multipartReq(fieldName) as any, {} as any, (err: unknown) => resolve(err));
    });

  it('rejects a field name whose array index exceeds the limit', async () => {
    const err = (await run('a[999999999]')) as { code?: string } | undefined;
    expect(err).toBeDefined();
    expect(err?.code).toBe('LIMIT_FIELD_ARRAY_INDEX');
  });

  // Negative control: without this, a guard that rejected everything would pass.
  it('accepts a field name with an index inside the limit', async () => {
    const err = await run('a[5]');
    expect(err).toBeUndefined();
  });

  // Pin the CONFIGURED boundary, not just "small passes, huge fails" -- these
  // two fail if MAX_FIELD_ARRAY_INDEX is ever changed without intent.
  it('accepts exactly the configured limit (index 100)', async () => {
    const err = await run('a[100]');
    expect(err).toBeUndefined();
  });

  it('rejects one past the configured limit (index 101)', async () => {
    const err = (await run('a[101]')) as { code?: string } | undefined;
    expect(err?.code).toBe('LIMIT_FIELD_ARRAY_INDEX');
  });
});

/**
 * The static `upload` instance above is not what the storage routes use --
 * they go through `dynamicUploadSingle`, which builds its own multer instance
 * per request. A limit set on only one of the two would leave the user-facing
 * path exposed while the suite stayed green, so the production path gets its
 * own test rather than inheriting confidence from the static one.
 */
describe('dynamicUploadSingle honours fieldArrayIndexLimit', () => {
  const BOUNDARY = '----insforgeDynamicUploadBoundary';

  const multipartReq = (fieldName: string) => {
    const body = Buffer.from(
      `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"\r\n\r\n` +
        `x\r\n` +
        `--${BOUNDARY}--\r\n`,
      'utf8'
    );
    const req = Readable.from([body]) as Readable & { headers: Record<string, string> };
    req.headers = {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'content-length': String(body.length),
    };
    return req;
  };

  // The storage config lookup is unavailable here; the middleware is expected
  // to fall back to the env limit, which is the path this test exercises.
  const run = (fieldName: string): Promise<unknown> =>
    new Promise((resolve) => {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      void dynamicUploadSingle('file')(multipartReq(fieldName) as any, {} as any, (err: unknown) =>
        resolve(err)
      );
    });

  it('rejects an oversized array index on the dynamic uploader too', async () => {
    const err = (await run('a[999999999]')) as { code?: string } | undefined;
    expect(err).toBeDefined();
    expect(err?.code).toBe('LIMIT_FIELD_ARRAY_INDEX');
  });

  it('accepts an in-range index on the dynamic uploader', async () => {
    const err = await run('a[5]');
    expect(err).toBeUndefined();
  });

  it('accepts exactly the configured limit on the dynamic uploader', async () => {
    const err = await run('a[100]');
    expect(err).toBeUndefined();
  });

  it('rejects one past the configured limit on the dynamic uploader', async () => {
    const err = (await run('a[101]')) as { code?: string } | undefined;
    expect(err?.code).toBe('LIMIT_FIELD_ARRAY_INDEX');
  });
});
