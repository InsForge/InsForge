import express, { type ErrorRequestHandler } from 'express';
import http, { type Server } from 'http';
import { afterEach, describe, expect, test, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  isBucketPublic: vi.fn(),
  getObjectMetadataVisible: vi.fn(),
  getDownloadStrategy: vi.fn(),
  getObjectMetadataRow: vi.fn(),
  getObject: vi.fn(),
  objectIsVisible: vi.fn(),
  deleteObjects: vi.fn(),
  // Default undefined return keeps existing tests on the buffered local path.
  isS3Provider: vi.fn(),
  getProvider: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn((_req, _res, next) => next()),
  verifyUser: vi.fn((_req, _res, next) => next()),
}));

const requestMethod = (
  method: 'DELETE' | 'GET' | 'POST',
  port: number,
  path: string,
  body?: string
): Promise<{ statusCode: number; body: string }> =>
  new Promise((resolve, reject) => {
    const headers = body
      ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        }
      : undefined;
    const request = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () =>
          resolve({ statusCode: response.statusCode ?? 0, body: responseBody })
        );
      }
    );

    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });

const post = (port: number, path: string) => requestMethod('POST', port, path);
const get = (port: number, path: string) => requestMethod('GET', port, path);
const deleteJson = (port: number, path: string, body: string) =>
  requestMethod('DELETE', port, path, body);

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

  test('batch delete route validates body and delegates to storage service', async () => {
    vi.resetModules();
    storageMocks.deleteObjects.mockResolvedValue({
      results: [
        { key: 'a.txt', status: 'deleted' },
        { key: 'missing.txt', status: 'notFound' },
      ],
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

    const response = await deleteJson(
      address.port,
      '/api/storage/buckets/photos/objects',
      JSON.stringify({ keys: ['a.txt', 'missing.txt'] })
    );

    expect(response.statusCode, response.body).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      results: [
        { key: 'a.txt', status: 'deleted' },
        { key: 'missing.txt', status: 'notFound' },
      ],
    });
    expect(storageMocks.deleteObjects).toHaveBeenCalledWith(
      undefined,
      'photos',
      ['a.txt', 'missing.txt'],
      false
    );
  });

  test('batch delete route returns 400 for an empty key list', async () => {
    vi.resetModules();

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

    const response = await deleteJson(
      address.port,
      '/api/storage/buckets/photos/objects',
      JSON.stringify({ keys: [] })
    );

    expect(response.statusCode, response.body).toBe(400);
    expect(storageMocks.deleteObjects).not.toHaveBeenCalled();
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
      { asAttachment: false, prefetchedMetadata: true }
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
      { asAttachment: false, prefetchedMetadata: true }
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
      { asAttachment: false, prefetchedMetadata: true }
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
      { asAttachment: false, prefetchedMetadata: true }
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

  test('direct download route applies read-time defense for unsafe MIME types', async () => {
    vi.resetModules();
    storageMocks.getObjectMetadataVisible.mockResolvedValue({
      mime_type: 'text/html',
      bucket: 'test-bucket',
      key: 'test.html',
    });
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'direct',
      url: 'http://localhost:7130/api/storage/buckets/product-images/objects/products/prod_123/main.html',
    });
    storageMocks.getObject.mockResolvedValue({
      file: Buffer.from('<html><script>alert(1)</script></html>'),
      metadata: { mimeType: 'text/html' },
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

    const request = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: '/api/storage/buckets/product-images/objects/products/prod_123/main.html',
      method: 'GET',
    });

    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      request.on('response', resolve);
      request.on('error', reject);
      request.end();
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('attachment');
  });

  const rawGet = (
    port: number,
    path: string,
    headers?: Record<string, string>
  ): Promise<{ response: http.IncomingMessage; body: Buffer }> =>
    new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path, method: 'GET', headers });
      request.on('response', (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk as Buffer));
        response.on('end', () => resolve({ response, body: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
      request.end();
    });

  const startProxyModeServer = async () => {
    vi.resetModules();
    storageMocks.getObjectMetadataVisible.mockResolvedValue({
      mime_type: 'image/png',
      bucket: 'photos',
      key: 'pic.png',
      size: 10,
    });
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'direct',
      url: 'http://localhost:7130/api/storage/buckets/photos/objects/pic.png',
    });
    storageMocks.isS3Provider.mockReturnValue(true);

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use('/api/storage', storageRouter);
    app.use(routeErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }
    return address.port;
  };

  test('proxy-mode download streams the full object with 200 and length headers', async () => {
    const { Readable } = await import('stream');
    const getObjectStream = vi.fn().mockResolvedValue({
      body: Readable.from([Buffer.from('0123456789')]),
      size: 10,
      etag: 'abc',
      contentType: 'image/png',
      lastModified: new Date(),
    });
    storageMocks.getProvider.mockReturnValue({ getObjectStream });

    const port = await startProxyModeServer();
    const { response, body } = await rawGet(port, '/api/storage/buckets/photos/objects/pic.png');

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-length']).toBe('10');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['etag']).toBe('"abc"');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(body.toString()).toBe('0123456789');
    expect(getObjectStream).toHaveBeenCalledWith('photos', 'pic.png', { range: undefined });
    expect(storageMocks.getObject).not.toHaveBeenCalled();
  });

  test('proxy-mode download honors Range with 206 and Content-Range passthrough', async () => {
    const { Readable } = await import('stream');
    const getObjectStream = vi.fn().mockResolvedValue({
      body: Readable.from([Buffer.from('0123')]),
      size: 4,
      etag: 'abc',
      contentType: 'image/png',
      lastModified: new Date(),
      contentRange: 'bytes 0-3/10',
    });
    storageMocks.getProvider.mockReturnValue({ getObjectStream });

    const port = await startProxyModeServer();
    const { response, body } = await rawGet(port, '/api/storage/buckets/photos/objects/pic.png', {
      Range: 'bytes=0-3',
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 0-3/10');
    expect(response.headers['content-length']).toBe('4');
    expect(body.toString()).toBe('0123');
    expect(getObjectStream).toHaveBeenCalledWith('photos', 'pic.png', { range: 'bytes=0-3' });
  });

  test('proxy-mode download maps InvalidRange to 416 with the full size', async () => {
    const getObjectStream = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('range'), { name: 'InvalidRange', $metadata: { httpStatusCode: 416 } })
      );
    storageMocks.getProvider.mockReturnValue({ getObjectStream });

    const port = await startProxyModeServer();
    const { response } = await rawGet(port, '/api/storage/buckets/photos/objects/pic.png', {
      Range: 'bytes=100-200',
    });

    expect(response.statusCode).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */10');
  });

  test('proxy-mode download returns 404 when the blob is missing behind the metadata row', async () => {
    const getObjectStream = vi.fn().mockRejectedValue(new Error('GetObject returned empty body'));
    storageMocks.getProvider.mockReturnValue({ getObjectStream });

    const port = await startProxyModeServer();
    const { response } = await rawGet(port, '/api/storage/buckets/photos/objects/pic.png');

    expect(response.statusCode).toBe(404);
  });

  test('download strategy route returns 404 for missing or invisible objects', async () => {
    vi.resetModules();
    storageMocks.isBucketPublic.mockResolvedValue(true);
    storageMocks.getObjectMetadataVisible.mockResolvedValue(null);

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
      '/api/storage/buckets/product-images/objects/products/prod_123/missing.jpg/download-strategy'
    );

    expect(response.statusCode, response.body).toBe(404);
    expect(storageMocks.getDownloadStrategy).not.toHaveBeenCalled();
  });
});
