import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/errors';

// ---------------------------------------------------------------------------
// Mocks – shared across both describe blocks
// ---------------------------------------------------------------------------
const { poolQueryMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        query: poolQueryMock,
        connect: connectMock,
      })),
    })),
    clearColumnTypeCache: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { AdminRecordService } from '../../src/services/database/admin-record.service';
import { DatabaseTableService } from '../../src/services/database/database-table.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeService() {
  return DatabaseTableService.getInstance();
}

function makeAdminService() {
  return AdminRecordService.getInstance();
}

// ---------------------------------------------------------------------------
// Tests – getFkeyConstraints
// ---------------------------------------------------------------------------
describe('DatabaseTableService – getFkeyConstraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly pairs source and reference columns in a composite FK (positional join)', async () => {
    const fkRows = [
      {
        constraint_name: 'fk_composite_test_ref_composite_tenant_id_item_id',
        from_column: 'tenant_id',
        foreign_schema: 'public',
        foreign_table: 'ref_composite',
        foreign_column: 'tenant_id',
        ordinal_position: 1,
        on_delete: 'NO ACTION',
        on_update: 'CASCADE',
      },
      {
        constraint_name: 'fk_composite_test_ref_composite_tenant_id_item_id',
        from_column: 'item_id',
        foreign_schema: 'public',
        foreign_table: 'ref_composite',
        foreign_column: 'item_id',
        ordinal_position: 2,
        on_delete: 'NO ACTION',
        on_update: 'CASCADE',
      },
    ];

    poolQueryMock.mockResolvedValueOnce({ rows: fkRows });

    const service = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await (service as any).getFkeyConstraints('public', 'composite_test');

    expect(map.size).toBe(2);

    // Each source column should map to the full composite FK info
    for (const col of ['tenant_id', 'item_id']) {
      const entry = map.get(col);
      expect(entry).toBeDefined();
      expect(entry!.constraint_name).toBe('fk_composite_test_ref_composite_tenant_id_item_id');
      expect(entry!.referenceTable).toBe('ref_composite');
      expect(entry!.referenceColumns).toHaveLength(2);
      expect(entry!.referenceColumns[0]).toEqual({
        sourceColumn: 'tenant_id',
        referenceColumn: 'tenant_id',
      });
      expect(entry!.referenceColumns[1]).toEqual({
        sourceColumn: 'item_id',
        referenceColumn: 'item_id',
      });
    }
  });

  it('does not cross-join columns when reference column values are duplicated across tuples', async () => {
    // Simulate two rows in the referenced table that share a common column value:
    //   (tenant_a, item_1)
    //   (tenant_a, item_2)
    // The positional join must pair tenant_id→tenant_id and item_id→item_id,
    // never tenant_id→item_id.
    const fkRows = [
      {
        constraint_name: 'fk_child_parent_tenant_id_item_id',
        from_column: 'tenant_id',
        foreign_schema: 'public',
        foreign_table: 'parent_composite',
        foreign_column: 'tenant_id',
        ordinal_position: 1,
        on_delete: 'RESTRICT',
        on_update: 'CASCADE',
      },
      {
        constraint_name: 'fk_child_parent_tenant_id_item_id',
        from_column: 'item_id',
        foreign_schema: 'public',
        foreign_table: 'parent_composite',
        foreign_column: 'item_id',
        ordinal_position: 2,
        on_delete: 'RESTRICT',
        on_update: 'CASCADE',
      },
    ];

    poolQueryMock.mockResolvedValueOnce({ rows: fkRows });

    const service = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await (service as any).getFkeyConstraints('public', 'child');

    const tenantEntry = map.get('tenant_id');
    const itemEntry = map.get('item_id');

    expect(tenantEntry).toBeDefined();
    expect(itemEntry).toBeDefined();

    // Both entries must carry the same full referenceColumns array
    const expectedPairs = [
      { sourceColumn: 'tenant_id', referenceColumn: 'tenant_id' },
      { sourceColumn: 'item_id', referenceColumn: 'item_id' },
    ];

    expect(tenantEntry!.referenceColumns).toEqual(expectedPairs);
    expect(itemEntry!.referenceColumns).toEqual(expectedPairs);
  });

  it('handles single-column FKs without breaking', async () => {
    const fkRows = [
      {
        constraint_name: 'fk_orders_user_id',
        from_column: 'user_id',
        foreign_schema: 'public',
        foreign_table: 'users',
        foreign_column: 'id',
        ordinal_position: 1,
        on_delete: 'CASCADE',
        on_update: 'CASCADE',
      },
    ];

    poolQueryMock.mockResolvedValueOnce({ rows: fkRows });

    const service = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await (service as any).getFkeyConstraints('public', 'orders');

    expect(map.size).toBe(1);
    const entry = map.get('user_id');
    expect(entry!.referenceColumns).toHaveLength(1);
    expect(entry!.referenceColumns[0]).toEqual({
      sourceColumn: 'user_id',
      referenceColumn: 'id',
    });
    expect(entry!.referenceTable).toBe('users');
    expect(entry!.onDelete).toBe('CASCADE');
    expect(entry!.onUpdate).toBe('CASCADE');
  });

  it('returns empty map when table has no foreign keys', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    const service = makeService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = await (service as any).getFkeyConstraints('public', 'no_fk_table');

    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests – lookupRecord (multi-column)
// ---------------------------------------------------------------------------
describe('AdminRecordService – lookupRecord (composite FK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
    });
  });

  it('builds multi-column WHERE clause and returns the correct record', async () => {
    // Simulate metadata query + lookup query
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'tenant_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'item_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'label', data_type: 'text', is_nullable: 'YES', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('SELECT * FROM')) {
        return {
          rows: [
            {
              tenant_id: 'tenant_a',
              item_id: 'item_2',
              label: 'item A2',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const service = makeAdminService();
    const result = await service.lookupRecord(
      'public',
      'parent_composite',
      ['tenant_id', 'item_id'],
      ['tenant_a', 'item_2']
    );

    // Verify the correct row was returned
    expect(result).toEqual({
      tenant_id: 'tenant_a',
      item_id: 'item_2',
      label: 'item A2',
    });

    // Verify the SQL uses multi-column WHERE
    const dataQueryCall = clientQueryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SELECT * FROM')
    );
    expect(dataQueryCall).toBeDefined();
    expect(dataQueryCall![0] as string).toMatch(
      /WHERE\s+"tenant_id"\s*=\s*\$1\s+AND\s+"item_id"\s*=\s*\$2\s+LIMIT\s+1/i
    );
    expect(dataQueryCall![1]).toEqual(['tenant_a', 'item_2']);
  });

  it('returns null when no row matches the composite key', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'tenant_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'item_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('SELECT * FROM')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const service = makeAdminService();
    const result = await service.lookupRecord(
      'public',
      'parent_composite',
      ['tenant_id', 'item_id'],
      ['tenant_a', 'nonexistent']
    );

    expect(result).toBeNull();
  });

  it('throws when columns and values have mismatched lengths', async () => {
    const service = makeAdminService();

    await expect(
      service.lookupRecord('public', 't', ['tenant_id', 'item_id'], ['tenant_a'])
    ).rejects.toBeInstanceOf(AppError);
  });

  it('correctly distinguishes between rows that share a column value', async () => {
    // Two rows share the same tenant_id but have different item_ids.
    // Lookup by (tenant_a, item_1) must return the first row, not the second.
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'tenant_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'item_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'label', data_type: 'text', is_nullable: 'YES', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('SELECT * FROM')) {
        return {
          rows: [
            {
              tenant_id: 'tenant_a',
              item_id: 'item_1',
              label: 'item A1',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const service = makeAdminService();
    const result = await service.lookupRecord(
      'public',
      'parent_composite',
      ['tenant_id', 'item_id'],
      ['tenant_a', 'item_1']
    );

    expect(result).toEqual({
      tenant_id: 'tenant_a',
      item_id: 'item_1',
      label: 'item A1',
    });

    // Confirm the exact params passed to the data query
    const dataQueryCall = clientQueryMock.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('SELECT * FROM')
    );
    expect(dataQueryCall![1]).toEqual(['tenant_a', 'item_1']);
  });
});
