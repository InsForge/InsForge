import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    request: requestMock,
    withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
    getAccessToken: vi.fn(() => 'token'),
  },
}));

import { storageService } from './storage.service';

describe('storageService.renameObject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the rename endpoint with the expected payload', async () => {
    requestMock.mockResolvedValueOnce({ key: 'folder/cover.png' });

    await storageService.renameObject('assets', 'folder/photo.png', 'cover.png');

    expect(requestMock).toHaveBeenCalledWith('/storage/buckets/assets/objects/folder%2Fphoto.png', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ newName: 'cover.png' }),
    });
  });
});
