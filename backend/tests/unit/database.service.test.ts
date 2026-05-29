import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        query: poolQueryMock,
      })),
    })),
  },
}));

import { DatabaseService } from '../../src/services/database/database.service';

describe('DatabaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives dashboard schema protection from project_admin CREATE privilege', async () => {
    poolQueryMock.mockResolvedValue({
      rows: [
        { name: 'public', isProtected: false },
        { name: 'analytics', isProtected: false },
        { name: 'auth', isProtected: true },
      ],
    });

    const service = DatabaseService.getInstance();
    const result = await service.getSchemas();

    expect(result).toEqual({
      schemas: [
        { name: 'public', isProtected: false },
        { name: 'analytics', isProtected: false },
        { name: 'auth', isProtected: true },
      ],
    });

    expect(poolQueryMock).toHaveBeenCalledWith(expect.any(String), ['public']);

    const sql = poolQueryMock.mock.calls[0]?.[0] as string;
    expect(sql).toContain("has_schema_privilege(to_regrole('project_admin'), n.oid, 'CREATE')");
    expect(sql).not.toContain('ANY($1::text[])');
  });
});
