import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors.js';

// Regression test for public-bucket downloads answering 401 "No token
// provided" when the bucket visibility lookup itself failed (project DB out
// of connection slots). The middleware must surface that as 503, not fall
// through to the token check.

const storageMocks = vi.hoisted(() => ({
  isBucketPublic: vi.fn(),
  getObjectMetadataVisible: vi.fn(),
  getDownloadStrategy: vi.fn(),
  isS3Provider: vi.fn(() => false),
  getObject: vi.fn(),
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({ default: loggerMocks }));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  verifyUser: (
    req: { headers: Record<string, string | undefined> },
    _res: unknown,
    next: (err?: unknown) => void
  ) => {
    if (!req.headers.authorization) {
      return next(new AppError('No token provided', 401, ERROR_CODES.AUTH_INVALID_CREDENTIALS));
    }
    next();
  },
}));

vi.mock('../../src/services/storage/storage.service.js', () => ({
  StorageService: { getInstance: () => storageMocks },
}));

vi.mock('../../src/services/storage/storage-config.service.js', () => ({
  StorageConfigService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/storage/s3-access-key.service.js', () => ({
  S3AccessKeyService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn() }) },
}));

vi.mock('../../src/services/dashboard/dashboard-event.service.js', () => ({
  dashboardEventService: { emit: vi.fn() },
}));

// Duck-typed rather than instanceof: vi.resetModules() gives the router its
// own AppError class identity, distinct from this file's import.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs arity 4
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
  res.status(status).json({
    error: error.code ?? 'INTERNAL_ERROR',
    message: error.message,
    statusCode: status,
  });
};

async function createApp() {
  const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
  const app = express();
  app.use('/api/storage', storageRouter);
  app.use(errorHandler);
  return app;
}

describe('storage download auth when the bucket visibility lookup fails', () => {
  beforeEach(() => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockReset();
    storageMocks.getObjectMetadataVisible.mockReset();
    storageMocks.getDownloadStrategy.mockReset();
    loggerMocks.error.mockClear();
  });

  it('returns 503 STORAGE_UNAVAILABLE with Retry-After instead of 401', async () => {
    storageMocks.isBucketPublic.mockRejectedValue(new Error('sorry, too many clients already'));
    const app = await createApp();

    const res = await request(app).get(
      '/api/storage/buckets/avatars/objects/agents%2Fmuse%2Flogo.webp'
    );

    expect(res.status).toBe(503);
    expect(res.body.error).toBe(ERROR_CODES.STORAGE_UNAVAILABLE);
    expect(res.headers['retry-after']).toBe('5');
    expect(loggerMocks.error).toHaveBeenCalledWith(
      'Bucket visibility lookup failed',
      expect.objectContaining({ bucket: 'avatars', error: 'sorry, too many clients already' })
    );
  });

  it('still returns 401 for anonymous requests on a private bucket', async () => {
    storageMocks.isBucketPublic.mockResolvedValue(false);
    const app = await createApp();

    const res = await request(app).get('/api/storage/buckets/private/objects/secret.png');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe(ERROR_CODES.AUTH_INVALID_CREDENTIALS);
  });

  it('skips auth on a public bucket and reaches the object lookup', async () => {
    storageMocks.isBucketPublic.mockResolvedValue(true);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(null);
    const app = await createApp();

    const res = await request(app).get('/api/storage/buckets/avatars/objects/missing.png');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe(ERROR_CODES.STORAGE_NOT_FOUND);
  });
});
