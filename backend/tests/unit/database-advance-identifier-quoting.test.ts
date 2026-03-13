import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';

type DatabaseAdvanceServiceTestApi = {
  quoteTableIdentifier: (table: string) => string;
  getTableData: (
    client: typeof mockClient,
    table: string,
    rowLimit: number | undefined
  ) => Promise<{ rows: { id: number }[]; totalRows: number; wasTruncated: boolean }>;
};

describe('DatabaseAdvanceService table identifier quoting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('quotes dangerous table names while preserving schema-qualified identifiers', () => {
    const service = DatabaseAdvanceService.getInstance() as unknown as DatabaseAdvanceServiceTestApi;

    expect(service.quoteTableIdentifier('users')).toBe('users');
    expect(service.quoteTableIdentifier('public.users')).toMatch(/^"?public"?\."?users"?$/);
    expect(service.quoteTableIdentifier('users; DROP TABLE audit_log;--')).toBe(
      '"users; DROP TABLE audit_log;--"'
    );
  });

  it('uses quoted table identifiers for count and select queries', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ count: '3' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

    const service = DatabaseAdvanceService.getInstance() as unknown as DatabaseAdvanceServiceTestApi;
    const result = await service.getTableData(mockClient, 'users; DROP TABLE audit_log;--', 2);

    expect(mockClient.query).toHaveBeenNthCalledWith(
      1,
      'SELECT COUNT(*) FROM "users; DROP TABLE audit_log;--"'
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      'SELECT * FROM "users; DROP TABLE audit_log;--" LIMIT 2'
    );
    expect(result).toEqual({
      rows: [{ id: 1 }],
      totalRows: 3,
      wasTruncated: true,
    });
  });
});
