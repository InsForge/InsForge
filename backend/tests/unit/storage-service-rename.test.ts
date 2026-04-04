import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockPool = {
  query: mockQuery,
  connect: mockConnect,
};

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

const mockCopyObject = vi.fn();
const mockDeleteObject = vi.fn();
const mockInitialize = vi.fn();

vi.mock('@/providers/storage/local.provider.js', () => ({
  LocalStorageProvider: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    copyObject: mockCopyObject,
    deleteObject: mockDeleteObject,
  })),
}));

vi.mock('@/providers/storage/s3.provider.js', () => ({
  S3StorageProvider: vi.fn(),
}));

vi.mock('@/services/storage/storage-config.service.js', () => ({
  StorageConfigService: {
    getInstance: () => ({
      getMaxFileSizeBytes: vi.fn().mockResolvedValue(50 * 1024 * 1024),
      getStorageConfig: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/environment.js', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

import { StorageService } from '../../src/services/storage/storage.service.ts';

// Reset singleton between tests
function getService(): StorageService {
  // Force new instance by clearing singleton
  (StorageService as unknown as { instance: StorageService | null }).instance = null;
  return StorageService.getInstance();
}

describe('StorageService.renameObject', () => {
  let service: StorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = getService();
  });

  it('renames file successfully (happy path)', async () => {
    const dbRow = {
      size: 1024,
      mime_type: 'text/plain',
      uploadedAt: new Date('2026-01-01'),
    };

    mockCopyObject.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [dbRow] });
    mockDeleteObject.mockResolvedValue(undefined);

    const result = await service.renameObject('my-bucket', 'old.txt', 'new.txt', 'user-1', false);

    expect(mockCopyObject).toHaveBeenCalledWith('my-bucket', 'old.txt', 'new.txt');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE storage.objects SET key = $1'),
      ['new.txt', 'my-bucket', 'old.txt', 'user-1']
    );
    expect(mockDeleteObject).toHaveBeenCalledWith('my-bucket', 'old.txt');
    expect(result).toEqual({
      bucket: 'my-bucket',
      key: 'new.txt',
      size: 1024,
      mimeType: 'text/plain',
      uploadedAt: dbRow.uploadedAt,
      url: 'http://localhost:3000/api/storage/buckets/my-bucket/objects/new.txt',
    });
  });

  it('throws 409 when newKey already exists (unique constraint violation)', async () => {
    mockCopyObject.mockResolvedValue(undefined);
    const pgError = new Error('duplicate key value violates unique constraint');
    (pgError as unknown as { code: string }).code = '23505';
    mockQuery.mockRejectedValue(pgError);
    mockDeleteObject.mockResolvedValue(undefined);

    await expect(
      service.renameObject('my-bucket', 'old.txt', 'existing.txt', 'user-1', false)
    ).rejects.toThrow('already exists');

    // Should clean up the copy
    expect(mockDeleteObject).toHaveBeenCalledWith('my-bucket', 'existing.txt');
  });

  it('throws 404 when oldKey not found (rowCount === 0)', async () => {
    mockCopyObject.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    mockDeleteObject.mockResolvedValue(undefined);

    await expect(
      service.renameObject('my-bucket', 'missing.txt', 'new.txt', 'user-1', false)
    ).rejects.toThrow('not found');

    // Should clean up the copy
    expect(mockDeleteObject).toHaveBeenCalledWith('my-bucket', 'new.txt');
  });

  it('cleans up newKey copy if DB update fails with generic error', async () => {
    mockCopyObject.mockResolvedValue(undefined);
    mockQuery.mockRejectedValue(new Error('connection lost'));
    mockDeleteObject.mockResolvedValue(undefined);

    await expect(
      service.renameObject('my-bucket', 'old.txt', 'new.txt', 'user-1', false)
    ).rejects.toThrow('connection lost');

    // All DB failures clean up the copied object
    expect(mockDeleteObject).toHaveBeenCalledWith('my-bucket', 'new.txt');
  });

  it('logs warning if deleteObject(oldKey) fails after successful rename', async () => {
    const logger = (await import('../../src/utils/logger.ts')).default;

    const dbRow = {
      size: 2048,
      mime_type: 'image/png',
      uploadedAt: new Date('2026-02-01'),
    };

    mockCopyObject.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [dbRow] });
    // First call is deleteObject(oldKey) inside the success path
    mockDeleteObject.mockRejectedValueOnce(new Error('S3 timeout'));

    const result = await service.renameObject('my-bucket', 'old.png', 'new.png', 'user-1', false);

    // Should still return successfully
    expect(result.key).toBe('new.png');
    // Should have logged a warning
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete old key'),
      expect.objectContaining({ bucket: 'my-bucket', oldKey: 'old.png' })
    );
  });

  it('non-admin cannot rename another user\'s file (uploaded_by check)', async () => {
    mockCopyObject.mockResolvedValue(undefined);
    // rowCount=0 means the WHERE clause (with uploaded_by) didn't match
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    mockDeleteObject.mockResolvedValue(undefined);

    await expect(
      service.renameObject('my-bucket', 'other-users-file.txt', 'renamed.txt', 'user-2', false)
    ).rejects.toThrow('not found');

    // Non-admin query should include uploaded_by parameter
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('uploaded_by'),
      ['renamed.txt', 'my-bucket', 'other-users-file.txt', 'user-2']
    );
  });

  it('admin can rename any user\'s file (bypasses uploaded_by)', async () => {
    const dbRow = {
      size: 512,
      mime_type: 'application/pdf',
      uploadedAt: new Date('2026-03-01'),
    };

    mockCopyObject.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [dbRow] });
    mockDeleteObject.mockResolvedValue(undefined);

    const result = await service.renameObject('my-bucket', 'file.pdf', 'renamed.pdf', 'admin-1', true);

    expect(result.key).toBe('renamed.pdf');
    // Admin query should NOT include uploaded_by — only 3 params
    expect(mockQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('uploaded_by'),
      ['renamed.pdf', 'my-bucket', 'file.pdf']
    );
  });

  it('throws on invalid key with directory traversal', async () => {
    await expect(
      service.renameObject('my-bucket', 'old.txt', '../escape.txt', 'user-1', false)
    ).rejects.toThrow('Invalid key');

    // copyObject should never be called
    expect(mockCopyObject).not.toHaveBeenCalled();
  });

  it('throws on invalid bucket name', async () => {
    await expect(
      service.renameObject('bad bucket!', 'old.txt', 'new.txt', 'user-1', false)
    ).rejects.toThrow('Invalid bucket name');

    expect(mockCopyObject).not.toHaveBeenCalled();
  });
});
