import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTableService } from '../../src/services/database/database-table.service';

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn();

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        connect: connectMock,
        query: queryMock,
      })),
    })),
    clearColumnTypeCache: vi.fn(),
  },
}));

describe('DatabaseTableService RLS introspection and enablement', () => {
  let service: DatabaseTableService;
  let relrowsecurityValue = false;
  let tableFoundInPgClass = true;

  beforeEach(() => {
    vi.clearAllMocks();
    relrowsecurityValue = false;
    tableFoundInPgClass = true;
    service = DatabaseTableService.getInstance();

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    queryMock.mockImplementation(async (sql: string) => {
      // SET LOCAL ROLE / admin context
      if (
        sql.includes('SET LOCAL ROLE') ||
        sql.includes('RESET ROLE') ||
        sql.includes('BEGIN') ||
        sql.includes('COMMIT')
      ) {
        return { rows: [], rowCount: 0 };
      }

      // Columns from information_schema
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            {
              column_name: 'id',
              data_type: 'uuid',
              udt_name: 'uuid',
              is_nullable: 'NO',
              column_default: 'gen_random_uuid()',
              character_maximum_length: null,
            },
          ],
          rowCount: 1,
        };
      }

      // Foreign keys
      if (sql.includes('information_schema.table_constraints') && sql.includes('FOREIGN KEY')) {
        return { rows: [], rowCount: 0 };
      }

      // Primary keys
      if (sql.includes('information_schema.key_column_usage') && sql.includes('PRIMARY KEY')) {
        return { rows: [{ column_name: 'id' }], rowCount: 1 };
      }

      // Unique columns
      if (sql.includes("tc.constraint_type = 'UNIQUE'")) {
        return { rows: [], rowCount: 0 };
      }

      // Count
      if (sql.includes('SELECT COUNT(*) as row_count')) {
        return { rows: [{ row_count: 5 }], rowCount: 1 };
      }

      // RLS query on pg_class
      if (sql.includes('SELECT c.relrowsecurity') && sql.includes('FROM pg_catalog.pg_class c')) {
        if (!tableFoundInPgClass) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [{ relrowsecurity: relrowsecurityValue }],
          rowCount: 1,
        };
      }

      // ALTER TABLE ENABLE ROW LEVEL SECURITY
      if (sql.includes('ENABLE ROW LEVEL SECURITY')) {
        return { rows: [], rowCount: 0 };
      }

      // NOTIFY
      if (sql.includes('NOTIFY')) {
        return { rows: [], rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    });
  });

  describe('getTableSchema', () => {
    it('returns rlsEnabled: false when pg_class.relrowsecurity is false', async () => {
      relrowsecurityValue = false;
      const schema = await service.getTableSchema('public', 'notes');

      expect(schema.tableName).toBe('notes');
      expect(schema.schemaName).toBe('public');
      expect(schema.rlsEnabled).toBe(false);

      // Verify the query parameters
      const rlsQueryCall = queryMock.mock.calls.find((call) =>
        call[0].includes('SELECT c.relrowsecurity')
      );
      expect(rlsQueryCall).toBeDefined();
      expect(rlsQueryCall?.[1]).toEqual(['public', 'notes']);
    });

    it('returns rlsEnabled: true when pg_class.relrowsecurity is true', async () => {
      relrowsecurityValue = true;
      const schema = await service.getTableSchema('public', 'todos');

      expect(schema.tableName).toBe('todos');
      expect(schema.rlsEnabled).toBe(true);
    });

    it('distinguishes custom schemas correctly', async () => {
      relrowsecurityValue = true;
      const schema = await service.getTableSchema('custom_app', 'orders');

      expect(schema.schemaName).toBe('custom_app');
      expect(schema.tableName).toBe('orders');
      expect(schema.rlsEnabled).toBe(true);

      const rlsQueryCall = queryMock.mock.calls.find((call) =>
        call[0].includes('SELECT c.relrowsecurity')
      );
      expect(rlsQueryCall?.[1]).toEqual(['custom_app', 'orders']);
    });

    it('throws 404 when table columns are not found', async () => {
      queryMock.mockImplementationOnce(async () => ({ rows: [], rowCount: 0 }));
      await expect(service.getTableSchema('public', 'non_existent')).rejects.toThrow(
        'table not found'
      );
    });
  });

  describe('enableTableRLS', () => {
    it('executes ALTER TABLE ... ENABLE ROW LEVEL SECURITY and reloads PostgREST schema', async () => {
      const result = await service.enableTableRLS('public', 'notes');

      expect(result.rlsEnabled).toBe(true);
      expect(result.tableName).toBe('notes');
      expect(result.schemaName).toBe('public');

      const alterCall = queryMock.mock.calls.find((call) =>
        call[0].includes('ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;')
      );
      expect(alterCall).toBeDefined();

      const notifyCall = queryMock.mock.calls.find((call) =>
        call[0].includes("NOTIFY pgrst, 'reload schema';")
      );
      expect(notifyCall).toBeDefined();
    });

    it('throws 404 if table does not exist in pg_class', async () => {
      tableFoundInPgClass = false;
      await expect(service.enableTableRLS('public', 'ghost')).rejects.toThrow('ghost not found');
    });

    it('rejects invalid table identifier names safely', async () => {
      await expect(service.enableTableRLS('public', 'bad"name')).rejects.toThrow();
      await expect(service.enableTableRLS('public', '')).rejects.toThrow();
    });
  });
});
