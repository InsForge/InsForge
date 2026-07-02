import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { KvService } from '#features/kv/services/kv.service';

describe('KvService', () => {
  let service: KvService;

  beforeEach(() => {
    apiClientMock.request.mockReset();
    apiClientMock.withAccessToken.mockClear();
    service = new KvService();
  });

  it('lists keys for a namespace and unwraps the response', async () => {
    apiClientMock.request.mockResolvedValue({
      keys: [{ key: 'a', visibility: 'private', expiresAt: null, updatedAt: '2026-06-28' }],
    });

    await expect(service.listKeys('default')).resolves.toEqual([
      { key: 'a', visibility: 'private', expiresAt: null, updatedAt: '2026-06-28' },
    ]);
    expect(apiClientMock.request).toHaveBeenCalledWith('/kv/entries/default', {
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('url-encodes the namespace and key when reading a value', async () => {
    apiClientMock.request.mockResolvedValue({ value: { nested: true } });
    await expect(service.getValue('ns:1', 'user:42')).resolves.toEqual({ nested: true });
    expect(apiClientMock.request).toHaveBeenCalledWith('/kv/entries/ns%3A1/user%3A42', {
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('PUTs the set payload as JSON', async () => {
    apiClientMock.request.mockResolvedValue({ created: true, entry: null });
    await service.setValue('default', 'k', { value: { a: 1 }, visibility: 'public' });
    expect(apiClientMock.request).toHaveBeenCalledWith('/kv/entries/default/k', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ value: { a: 1 }, visibility: 'public' }),
    });
  });

  it('deletes a key and returns the boolean flag', async () => {
    apiClientMock.request.mockResolvedValue({ deleted: true });
    await expect(service.deleteKey('default', 'k')).resolves.toBe(true);
    expect(apiClientMock.request).toHaveBeenCalledWith('/kv/entries/default/k', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
    });
  });
});
