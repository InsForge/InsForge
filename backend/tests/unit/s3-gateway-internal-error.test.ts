import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockListBucketsHandle = vi.fn();

vi.mock('../../src/services/storage/storage.service.js', () => ({
  StorageService: {
    getInstance: () => ({
      isS3Provider: () => true,
    }),
  },
}));

vi.mock('../../src/api/middlewares/s3-sigv4.js', () => ({
  s3Sigv4Middleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { s3Auth?: { accessKeyId: string; requestId: string } }).s3Auth = {
      accessKeyId: 'test-ak',
      requestId: 'req-12345',
    };
    next();
  },
}));

vi.mock('../../src/api/routes/s3-gateway/commands/list-buckets.js', () => ({
  handle: mockListBucketsHandle,
}));

describe('s3-gateway error sanitization', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { s3GatewayRouter } = await import('../../src/api/routes/s3-gateway/index.routes.js');
    app = express();
    app.use('/s3', s3GatewayRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('masks internal error details in S3 XML InternalError response', async () => {
    mockListBucketsHandle.mockRejectedValueOnce(
      new Error('database "insforge" connection lost: password leaked or table dropped')
    );

    const res = await request(app).get('/s3/').set('Host', 'localhost');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<Code>InternalError</Code>');
    expect(res.text).toContain('<Message>We encountered an internal error. Please try again.</Message>');
    expect(res.text).not.toContain('database "insforge" connection lost');
    expect(res.text).not.toContain('password leaked');
  });
});
