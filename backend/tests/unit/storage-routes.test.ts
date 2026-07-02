import express, { type ErrorRequestHandler } from 'express';
import http, { type Server } from 'http';
import { afterEach, describe, expect, test, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  isBucketPublic: vi.fn(),
  getObjectMetadataVisible: vi.fn(),
  getDownloadStrategy: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn((_req, _res, next) => next()),
  verifyUser: vi.fn((_req, _res, next) => next()),
}));

const requestMethod = (
  method: 'GET' | 'POST',
  port: number,
  path: string
): Promise<{ statusCode: number; body: string }> =>
  new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
    });

    request.on('error', reject);
    request.end();
  });

const post = (port: number, path: string) => requestMethod('POST', port, path);
const get = (port: number, path: string) => requestMethod('GET', port, path);

const routeErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;

  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  const message = error instanceof Error ? error.message : 'Internal server error';

  res.status(statusCode).json({ message });
};

vi.mock('../../src/services/storage/storage.service.js', () => ({
  StorageService: {
    getInstance: () => storageMocks,
  },
}));

vi.mock('../../src/services/storage/storage-config.service.js', () => ({
  StorageConfigService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: {
    getInstance: () => ({
      log: vi.fn(),
    }),
  },
}));

vi.mock('../../src/infra/socket/socket.manager.js', () => ({
  SocketManager: {
    getInstance: () => ({
      broadcastToRoom: vi.fn(),
    }),
  },
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: authMocks.verifyAdmin,
  verifyUser: authMocks.verifyUser,
}));

describe('Storage routes', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.clearAllMocks();
  });

  test('download strategy route captures nested object keys', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(true);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(true);
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'direct',
      url: 'http://localhost:7130/api/storage/buckets/product-images/objects/products%2Fprod_123%2Fmain.jpg',
    });

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await post(
      address.port,
      '/api/storage/buckets/product-images/objects/products/prod_123/main.jpg/download-strategy'
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(storageMocks.getDownloadStrategy).toHaveBeenCalledWith(
      'product-images',
      'products/prod_123/main.jpg',
      undefined,
      { prefetchedMetadata: true }
    );
    expect(authMocks.verifyUser).not.toHaveBeenCalled();
  });

  test('download strategy route returns 400 when object key is missing', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(true);

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await post(
      address.port,
      '/api/storage/buckets/product-images/objects//download-strategy'
    );

    expect(response.statusCode, response.body).toBe(400);
    expect(storageMocks.getDownloadStrategy).not.toHaveBeenCalled();
  });

  test('download strategy route requires auth middleware for private buckets', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(false);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(true);
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'direct',
      url: 'http://localhost:7130/api/storage/buckets/product-images/objects/products%2Fprod_123%2Fmain.jpg',
    });

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await post(
      address.port,
      '/api/storage/buckets/product-images/objects/products/prod_123/main.jpg/download-strategy'
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(authMocks.verifyUser).toHaveBeenCalledOnce();
    expect(storageMocks.getDownloadStrategy).toHaveBeenCalledWith(
      'product-images',
      'products/prod_123/main.jpg',
      undefined,
      { prefetchedMetadata: true }
    );
  });

  test('download strategy route forwards a caller-supplied expiresIn', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(false);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(true);
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'presigned',
      url: 'https://cdn.example.com/product-images/products%2Fprod_123%2Fmain.jpg?Signature=abc',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await post(
      address.port,
      '/api/storage/buckets/product-images/objects/products/prod_123/main.jpg/download-strategy?expiresIn=120'
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(storageMocks.getDownloadStrategy).toHaveBeenCalledWith(
      'product-images',
      'products/prod_123/main.jpg',
      120,
      { prefetchedMetadata: true }
    );
  });

  test('canonical GET download-strategy route forwards expiresIn', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(false);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(true);
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'presigned',
      url: 'https://cdn.example.com/product-images/products%2Fprod_123%2Fmain.jpg?Signature=abc',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await get(
      address.port,
      '/api/storage/buckets/product-images/download-strategy/objects/products/prod_123/main.jpg?expiresIn=120'
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(storageMocks.getDownloadStrategy).toHaveBeenCalledWith(
      'product-images',
      'products/prod_123/main.jpg',
      120,
      { prefetchedMetadata: true }
    );
  });

  test('download strategy route rejects a non-numeric expiresIn with 400', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(false);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(true);

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await get(
      address.port,
      '/api/storage/buckets/product-images/download-strategy/objects/products/prod_123/main.jpg?expiresIn=abc'
    );

    expect(response.statusCode, response.body).toBe(400);
    expect(storageMocks.getDownloadStrategy).not.toHaveBeenCalled();
  });
});
