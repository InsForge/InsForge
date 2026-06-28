import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockQuery, mockEmbed } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockEmbed: vi.fn(),
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => ({ query: mockQuery }) }),
  },
}));

vi.mock('@/services/ai/embedding.service.js', () => ({
  EmbeddingService: {
    getInstance: () => ({ createEmbeddings: mockEmbed }),
  },
}));

import { VectorService } from '@/services/vectors/vector.service';

const ADMIN = { mode: 'admin' as const };
const DIM = 1536;
const vec = (fill = 0.1) => Array.from({ length: DIM }, () => fill);

function collectionRow(metric = 'cosine') {
  return {
    rows: [{ id: 'col-1', name: 'docs', dimension: DIM, metric, created_at: new Date() }],
    rowCount: 1,
  };
}

describe('VectorService', () => {
  const service = VectorService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects collections whose dimension is not the supported 1536', async () => {
    await expect(
      service.createCollection(ADMIN, { name: 'x', dimension: 768, metric: 'cosine' })
    ).rejects.toMatchObject({ code: 'VECTOR_DIMENSION_MISMATCH', statusCode: 400 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('maps a unique-violation on create to VECTOR_COLLECTION_ALREADY_EXISTS', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.createCollection(ADMIN, { name: 'docs', dimension: DIM, metric: 'cosine' })
    ).rejects.toMatchObject({ code: 'VECTOR_COLLECTION_ALREADY_EXISTS', statusCode: 409 });
  });

  it('throws VECTOR_COLLECTION_NOT_FOUND when upserting into a missing collection', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // resolveCollection
    await expect(service.upsert(ADMIN, 'nope', [{ vector: vec() }])).rejects.toMatchObject({
      code: 'VECTOR_COLLECTION_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('auto-embeds content items in a single batched provider call', async () => {
    mockQuery.mockResolvedValueOnce(collectionRow()); // resolveCollection
    mockEmbed.mockResolvedValueOnce({
      data: [
        { embedding: vec(0.1), index: 0 },
        { embedding: vec(0.2), index: 1 },
      ],
    });
    // one item brings its own vector, two need embedding
    mockQuery.mockResolvedValue({ rows: [{ id: 'item-x' }], rowCount: 1 });

    const ids = await service.upsert(ADMIN, 'docs', [
      { vector: vec(0.9) },
      { content: 'hello' },
      { content: 'world' },
    ]);

    expect(ids).toHaveLength(3);
    // exactly one embedding call, batched with both content strings
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbed.mock.calls[0][0].input).toEqual(['hello', 'world']);
  });

  it('rejects a bring-your-own vector whose dimension is wrong', async () => {
    mockQuery.mockResolvedValueOnce(collectionRow());
    await expect(
      service.upsert(ADMIN, 'docs', [{ vector: [0.1, 0.2, 0.3] }])
    ).rejects.toMatchObject({ code: 'VECTOR_DIMENSION_MISMATCH', statusCode: 400 });
  });

  it('query uses the cosine operator and similarity score for a cosine collection', async () => {
    mockQuery.mockResolvedValueOnce(collectionRow('cosine')); // resolveCollection
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'item-1', content: 'hi', metadata: { tag: 'a' }, score: 0.92 }],
      rowCount: 1,
    });

    const matches = await service.query(ADMIN, 'docs', {
      vector: vec(),
      topK: 5,
      includeContent: true,
    });

    expect(matches).toEqual([{ id: 'item-1', score: 0.92, content: 'hi', metadata: { tag: 'a' } }]);
    const querySql = mockQuery.mock.calls[1][0] as string;
    expect(querySql).toContain('embedding <=> $1::vector');
    expect(querySql).toContain('1 - (embedding <=> $1::vector)');
  });

  it('query embeds text when no vector is supplied', async () => {
    mockQuery.mockResolvedValueOnce(collectionRow('cosine'));
    mockEmbed.mockResolvedValueOnce({ data: [{ embedding: vec(), index: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.query(ADMIN, 'docs', { text: 'find this', topK: 3, includeContent: true });
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbed.mock.calls[0][0].input).toEqual(['find this']);
  });

  it('query applies a metadata containment filter when provided', async () => {
    mockQuery.mockResolvedValueOnce(collectionRow('cosine'));
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await service.query(ADMIN, 'docs', {
      vector: vec(),
      topK: 5,
      includeContent: false,
      filter: { tenant: 'acme' },
    });
    const querySql = mockQuery.mock.calls[1][0] as string;
    expect(querySql).toContain('metadata @>');
  });
});
