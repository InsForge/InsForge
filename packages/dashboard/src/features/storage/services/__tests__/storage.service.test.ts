import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { storageService } from '#features/storage/services/storage.service';

describe('storageService', () => {
  beforeEach(() => {
    apiClientMock.request.mockReset();
    apiClientMock.withAccessToken.mockClear();
  });

  it('deletes objects with one batch DELETE request', async () => {
    apiClientMock.request.mockResolvedValue({
      deleted: ['a.txt'],
      notFound: ['missing.txt'],
      failed: [{ key: 'blocked.txt', message: 'Access denied' }],
    });

    const result = await storageService.deleteObjects('photos', [
      'a.txt',
      'missing.txt',
      'blocked.txt',
    ]);

    expect(apiClientMock.request).toHaveBeenCalledWith('/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: ['a.txt', 'missing.txt', 'blocked.txt'] }),
    });
    expect(result.success).toEqual(['a.txt']);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({
      key: 'missing.txt',
      error: new Error('Object not found'),
    });
    expect(result.failures[1]).toMatchObject({
      key: 'blocked.txt',
      error: new Error('Access denied'),
    });
  });

  it('does not call the API for an empty delete list', async () => {
    await expect(storageService.deleteObjects('photos', [])).resolves.toEqual({
      success: [],
      failures: [],
    });

    expect(apiClientMock.request).not.toHaveBeenCalled();
  });

  it('chunks deletes into batches of 1000 objects', async () => {
    apiClientMock.request
      .mockResolvedValueOnce({
        deleted: Array.from({ length: 1000 }, (_, index) => `file-${index}.txt`),
        notFound: [],
        failed: [],
      })
      .mockResolvedValueOnce({
        deleted: ['file-1000.txt'],
        notFound: [],
        failed: [],
      });
    const keys = Array.from({ length: 1001 }, (_, index) => `file-${index}.txt`);

    const result = await storageService.deleteObjects('photos', keys);

    expect(result).toEqual({ success: keys, failures: [] });
    expect(apiClientMock.request).toHaveBeenCalledTimes(2);
    expect(apiClientMock.request).toHaveBeenNthCalledWith(1, '/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: keys.slice(0, 1000) }),
    });
    expect(apiClientMock.request).toHaveBeenNthCalledWith(2, '/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: ['file-1000.txt'] }),
    });
  });

  it('returns structured failures when a batch request fails', async () => {
    apiClientMock.request.mockRejectedValue(new Error('HTTP 500'));

    const result = await storageService.deleteObjects('photos', ['a.txt', 'b.txt']);

    expect(result.success).toEqual([]);
    expect(result.failures).toEqual([
      { key: 'a.txt', error: new Error('HTTP 500') },
      { key: 'b.txt', error: new Error('HTTP 500') },
    ]);
  });
});
