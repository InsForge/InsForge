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
});
