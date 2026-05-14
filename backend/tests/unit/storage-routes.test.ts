import express from 'express';
import http, { type Server } from 'http';
import { afterEach, describe, expect, test, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  isBucketPublic: vi.fn(),
  getDownloadStrategy: vi.fn(),
}));

const post = (port: number, path: string): Promise<{ statusCode: number }> =>
  new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0 }));
      }
    );

    request.on('error', reject);
    request.end();
  });

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
  verifyAdmin: vi.fn((_req, _res, next) => next()),
  verifyUser: vi.fn((_req, _res, next) => next()),
}));

describe('Storage routes', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
    vi.clearAllMocks();
  });

  test('download strategy route captures nested object keys', async () => {
    storageMocks.isBucketPublic.mockResolvedValue(true);
    storageMocks.getDownloadStrategy.mockResolvedValue({
      method: 'direct',
      url: 'http://localhost:7130/api/storage/buckets/product-images/objects/products%2Fprod_123%2Fmain.jpg',
    });

    const { storageRouter } = await import('../../src/api/routes/storage/index.routes.js');
    const app = express();
    app.use(express.json());
    app.use('/api/storage', storageRouter);

    server = app.listen(0);
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await post(
      address.port,
      '/api/storage/buckets/product-images/objects/products/prod_123/main.jpg/download-strategy'
    );

    expect(response.statusCode).toBe(200);
    expect(storageMocks.getDownloadStrategy).toHaveBeenCalledWith(
      'product-images',
      'products/prod_123/main.jpg'
    );
  });
});
