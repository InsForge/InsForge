import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';
import { StorageService } from '../../src/services/storage/storage.service';

vi.mock('@/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        connect: vi.fn(),
      }),
    }),
  },
}));

describe('StorageService.renameObject', () => {
  const provider = {
    renameObject: vi.fn(),
  };

  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const service = StorageService.getInstance() as unknown as {
      provider: typeof provider;
      pool: { connect: ReturnType<typeof vi.fn> };
    };
    service.provider = provider;
    service.pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
  });

  it('renames a root-level file and preserves metadata', async () => {
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            bucket: 'assets',
            key: 'photo.png',
            size: 120,
            mime_type: 'image/png',
            uploaded_at: '2026-03-31T12:00:00.000Z',
            uploaded_by: 'user-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            bucket: 'assets',
            key: 'cover.png',
            size: 120,
            mime_type: 'image/png',
            uploaded_at: '2026-03-31T12:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce(undefined);

    const service = StorageService.getInstance();
    const result = await service.renameObject('assets', 'photo.png', 'cover.png', 'user-1', true);

    expect(provider.renameObject).toHaveBeenCalledWith('assets', 'photo.png', 'cover.png');
    expect(result).toMatchObject({
      bucket: 'assets',
      key: 'cover.png',
      size: 120,
      mimeType: 'image/png',
      uploadedAt: '2026-03-31T12:00:00.000Z',
    });
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenLastCalledWith('COMMIT');
  });

  it('renames a nested file while preserving its prefix', async () => {
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            bucket: 'assets',
            key: 'folder/photo.png',
            size: 120,
            mime_type: 'image/png',
            uploaded_at: '2026-03-31T12:00:00.000Z',
            uploaded_by: 'user-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            bucket: 'assets',
            key: 'folder/banner.png',
            size: 120,
            mime_type: 'image/png',
            uploaded_at: '2026-03-31T12:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce(undefined);

    const service = StorageService.getInstance();
    await service.renameObject('assets', 'folder/photo.png', 'banner.png', 'user-1', true);

    expect(provider.renameObject).toHaveBeenCalledWith(
      'assets',
      'folder/photo.png',
      'folder/banner.png'
    );
  });

  it('rejects invalid names with path separators or dot segments', async () => {
    const service = StorageService.getInstance();

    await expect(
      service.renameObject('assets', 'photo.png', 'folder/new.png', 'user-1', true)
    ).rejects.toThrow('Invalid file name');
    await expect(service.renameObject('assets', 'photo.png', '..', 'user-1', true)).rejects.toThrow(
      'Invalid file name'
    );
    await expect(
      service.renameObject('assets', 'photo.png', 'photo.png', 'user-1', true)
    ).rejects.toThrow('different');
    await expect(
      service.renameObject('assets', 'folder/', 'banner.png', 'user-1', true)
    ).rejects.toThrow('Only files can be renamed');

    expect(provider.renameObject).not.toHaveBeenCalled();
  });

  it('returns 404 when the source object does not exist', async () => {
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [],
      })
      .mockResolvedValueOnce(undefined);

    const service = StorageService.getInstance();

    await expect(
      service.renameObject('assets', 'missing.png', 'cover.png', 'user-1', true)
    ).rejects.toMatchObject<AppError>({
      statusCode: 404,
    });

    expect(provider.renameObject).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('returns 409 when the destination key already exists', async () => {
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        rows: [
          {
            bucket: 'assets',
            key: 'photo.png',
            size: 120,
            mime_type: 'image/png',
            uploaded_at: '2026-03-31T12:00:00.000Z',
            uploaded_by: 'user-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce(undefined);

    const service = StorageService.getInstance();

    await expect(
      service.renameObject('assets', 'photo.png', 'cover.png', 'user-1', true)
    ).rejects.toMatchObject<AppError>({
      statusCode: 409,
    });

    expect(provider.renameObject).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
  });
});
