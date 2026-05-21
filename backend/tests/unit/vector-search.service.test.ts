import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';
import { VectorSearchService } from '../../src/services/database/vectorSearch.service';

const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

describe('VectorSearchService', () => {
  let service: VectorSearchService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (VectorSearchService as any).instance = undefined;
    service = VectorSearchService.getInstance();
  });

  it('searches a pgvector column and omits the vector payload by default', async () => {
    mockClient.query.mockImplementation((query: string) => {
      if (query.includes('format_type')) {
        return Promise.resolve({ rows: [{ dataType: 'vector(3)' }] });
      }
      if (query.includes('row_to_json')) {
        return Promise.resolve({
          rows: [
            {
              row: { id: 1, title: 'hello', embedding: '[0.1,0.2,0.3]' },
              distance: 0.2,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.search(
      {
        table: 'documents',
        column: 'embedding',
        query_vector: [0.1, 0.2, 0.3],
        top_k: 5,
        metric: 'cosine',
        include_vector: false,
      },
      { role: 'project_admin' }
    );

    expect(result).toEqual({
      matches: [
        {
          row: { id: 1, title: 'hello' },
          distance: 0.2,
          similarity: 0.8,
        },
      ],
      count: 1,
      metric: 'cosine',
    });

    const searchCall = mockClient.query.mock.calls.find(
      ([query]) => typeof query === 'string' && query.includes('row_to_json')
    );
    expect(searchCall?.[0]).toContain('FROM "public"."documents" AS vector_source');
    expect(searchCall?.[0]).toContain('CROSS JOIN LATERAL');
    expect(searchCall?.[0]).toContain('ORDER BY vector_distance.distance');
    expect(searchCall?.[0]).toContain('vector_source."embedding" <=> $1::vector');
    expect(searchCall?.[1]).toEqual(['[0.1,0.2,0.3]', 5]);
  });

  it('runs non-admin searches with the user RLS context', async () => {
    mockClient.query.mockImplementation((query: string) => {
      if (query.includes('format_type')) {
        return Promise.resolve({ rows: [{ dataType: 'vector' }] });
      }
      if (query.includes('row_to_json')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    await service.search(
      {
        table: 'documents',
        column: 'embedding',
        query_vector: [1, 2, 3],
        top_k: 2,
        metric: 'l2',
        include_vector: true,
      },
      { id: 'user-1', email: 'user@example.com', role: 'authenticated' }
    );

    const executedStatements = mockClient.query.mock.calls.map(([query]) => String(query));
    expect(executedStatements).toContain('BEGIN');
    expect(executedStatements).toContain('SET LOCAL ROLE authenticated');
    expect(executedStatements).toContain('COMMIT');
    expect(executedStatements).toContain('RESET ROLE');
  });

  it('rejects non-vector columns', async () => {
    mockClient.query.mockImplementation((query: string) => {
      if (query.includes('format_type')) {
        return Promise.resolve({ rows: [{ dataType: 'text' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.search(
        {
          table: 'documents',
          column: 'body',
          query_vector: [0.1],
          top_k: 1,
          metric: 'cosine',
          include_vector: false,
        },
        { role: 'project_admin' }
      )
    ).rejects.toThrow(AppError);
  });

  it('rejects query vectors that do not match constrained column dimensions', async () => {
    mockClient.query.mockImplementation((query: string) => {
      if (query.includes('format_type')) {
        return Promise.resolve({ rows: [{ dataType: 'vector(3)' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await expect(
      service.search(
        {
          table: 'documents',
          column: 'embedding',
          query_vector: [0.1, 0.2],
          top_k: 1,
          metric: 'cosine',
          include_vector: false,
        },
        { role: 'project_admin' }
      )
    ).rejects.toThrow('query_vector dimensions (2) must match public.documents.embedding (3)');

    expect(
      mockClient.query.mock.calls.some(
        ([query]) => typeof query === 'string' && query.includes('row_to_json')
      )
    ).toBe(false);
  });

  it('blocks protected InsForge schemas', async () => {
    await expect(
      service.search(
        {
          schema: 'auth',
          table: 'users',
          column: 'embedding',
          query_vector: [0.1],
          top_k: 1,
          metric: 'cosine',
          include_vector: false,
        },
        { role: 'project_admin' }
      )
    ).rejects.toThrow(AppError);

    expect(mockPool.connect).not.toHaveBeenCalled();
  });
});
