import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../../src/infra/database/database.manager.js';

describe('DatabaseManager.getMetadata()', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    (
      DatabaseManager as unknown as { tableCountCache: Map<string, unknown> }
    ).tableCountCache.clear();

    mockQuery = vi.fn();
    const mockClient = {
      query: mockQuery,
      release: vi.fn(),
    };

    const instance = DatabaseManager.getInstance();
    (instance as unknown as { pool: unknown }).pool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };
  });

  it('queries catalog estimates instead of executing COUNT(*) UNION ALL', async () => {
    mockQuery
      // 1. getUserTables query
      .mockResolvedValueOnce({
        rows: [{ name: 'users' }, { name: 'orders' }],
      })
      // 2. getDatabaseSizeInGB query
      .mockResolvedValueOnce({
        rows: [{ size: 1073741824 }],
      })
      // 3. catalogEstimateQuery for table counts
      .mockResolvedValueOnce({
        rows: [
          { table_name: 'users', count: '150' },
          { table_name: 'orders', count: '2500' },
        ],
      });

    const instance = DatabaseManager.getInstance();
    const result = await instance.getMetadata();

    expect(result.tables).toEqual([
      { tableName: 'users', recordCount: 150 },
      { tableName: 'orders', recordCount: 2500 },
    ]);
    expect(result.totalSizeInGB).toBe(1);

    const calls = mockQuery.mock.calls;
    const catalogQueryCall = calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('pg_class')
    );
    expect(catalogQueryCall).toBeDefined();
    expect(catalogQueryCall![0]).toContain('reltuples');
    expect(catalogQueryCall![0]).not.toContain('COUNT(*)');
    expect(catalogQueryCall![0]).not.toContain('UNION ALL');
  });
});
