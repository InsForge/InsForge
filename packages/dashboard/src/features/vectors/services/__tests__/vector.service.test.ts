import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { VectorStoreService } from '#features/vectors/services/vector.service';

describe('VectorStoreService', () => {
  let service: VectorStoreService;

  beforeEach(() => {
    apiClientMock.request.mockReset();
    apiClientMock.withAccessToken.mockClear();
    service = new VectorStoreService();
  });

  it('lists collections and unwraps the response', async () => {
    apiClientMock.request.mockResolvedValue({
      collections: [
        { id: '1', name: 'docs', dimension: 1536, metric: 'cosine', createdAt: '2026-06-28' },
      ],
    });
    await expect(service.listCollections()).resolves.toHaveLength(1);
    expect(apiClientMock.request).toHaveBeenCalledWith('/vectors/collections', {
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('creates a collection with a POST and returns the collection', async () => {
    const collection = {
      id: '1',
      name: 'docs',
      dimension: 1536,
      metric: 'cosine',
      createdAt: '2026-06-28',
    };
    apiClientMock.request.mockResolvedValue({ collection });
    await expect(service.createCollection('docs')).resolves.toEqual(collection);
    expect(apiClientMock.request).toHaveBeenCalledWith('/vectors/collections', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ name: 'docs' }),
    });
  });

  it('queries a collection with text + topK and unwraps matches', async () => {
    apiClientMock.request.mockResolvedValue({
      matches: [{ id: 'i1', score: 0.9, content: 'hi', metadata: {} }],
    });
    await expect(service.query('docs', 'find this', 10)).resolves.toEqual([
      { id: 'i1', score: 0.9, content: 'hi', metadata: {} },
    ]);
    expect(apiClientMock.request).toHaveBeenCalledWith('/vectors/collections/docs/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ text: 'find this', topK: 10 }),
    });
  });

  it('url-encodes the collection name on delete', async () => {
    apiClientMock.request.mockResolvedValue({ deleted: true });
    await expect(service.deleteCollection('my docs')).resolves.toBe(true);
    expect(apiClientMock.request).toHaveBeenCalledWith('/vectors/collections/my%20docs', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
    });
  });
});
