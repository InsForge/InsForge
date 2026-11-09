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

  describe('getTableRlsStatuses', () => {
    it('returns bulk lightweight RLS status records using catalog query', async () => {
      queryMock.mockImplementationOnce(async (sql: string, params: unknown[]) => {
        expect(sql).toContain('FROM pg_catalog.pg_class c');
        expect(sql).toContain('JOIN pg_catalog.pg_namespace n');
        expect(sql).toContain("c.relkind IN ('r', 'p')");
        expect(params).toEqual(['public']);
        return {
          rows: [
            { schemaName: 'public', tableName: 'notes', rlsEnabled: false },
            { schemaName: 'public', tableName: 'todos', rlsEnabled: true },
          ],
          rowCount: 2,
        };
      });

      const result = await service.getTableRlsStatuses('public');

      expect(result).toEqual([
        { schemaName: 'public', tableName: 'notes', rlsEnabled: false },
        { schemaName: 'public', tableName: 'todos', rlsEnabled: true },
      ]);
    });

    it('rejects invalid schema name in getTableRlsStatuses', async () => {
      await expect(service.getTableRlsStatuses('bad"schema')).rejects.toThrow();
      await expect(service.getTableRlsStatuses('')).rejects.toThrow();
    });

    it('includes underscore-prefixed user tables in the returned status list', async () => {
      queryMock.mockImplementationOnce(async (sql: string) => {
        expect(sql).not.toContain('NOT LIKE');
        return {
          rows: [
            { schemaName: 'public', tableName: '_audit_log', rlsEnabled: false },
            { schemaName: 'public', tableName: '_session_store', rlsEnabled: true },
          ],
          rowCount: 2,
        };
      });

      const result = await service.getTableRlsStatuses('public');

      expect(result).toEqual([
        { schemaName: 'public', tableName: '_audit_log', rlsEnabled: false },
        { schemaName: 'public', tableName: '_session_store', rlsEnabled: true },
      ]);
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

    it('throws 404 if table does not exist in pg_class and executes neither ALTER nor NOTIFY', async () => {
      tableFoundInPgClass = false;
      await expect(service.enableTableRLS('public', 'ghost')).rejects.toThrow('ghost not found');

      const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
      const alterCall = sqlCalls.find((sql) => sql.includes('ENABLE ROW LEVEL SECURITY'));
      const notifyCall = sqlCalls.find((sql) => sql.includes('NOTIFY pgrst'));
      expect(alterCall).toBeUndefined();
      expect(notifyCall).toBeUndefined();
    });

    it('rolls back and releases connection when operation fails', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('ENABLE ROW LEVEL SECURITY')) {
          throw new Error('database disk full');
        }
        return { rows: [{ relrowsecurity: false }], rowCount: 1 };
      });

      await expect(service.enableTableRLS('public', 'notes')).rejects.toThrow('database disk full');

      const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
      expect(sqlCalls).toContain('ROLLBACK');
      expect(releaseMock).toHaveBeenCalledWith(undefined);
    });

    it('preserves original error and releases connection with error when rollback also fails', async () => {
      const rollbackError = new Error('connection lost on rollback');
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('ENABLE ROW LEVEL SECURITY')) {
          throw new Error('primary operation failed');
        }
        if (sql.includes('ROLLBACK')) {
          throw rollbackError;
        }
        return { rows: [{ relrowsecurity: false }], rowCount: 1 };
      });

      await expect(service.enableTableRLS('public', 'notes')).rejects.toThrow(
        'primary operation failed'
      );

      expect(releaseMock).toHaveBeenCalledWith(rollbackError);
    });

    it('rejects invalid table identifier names with exact validation error', async () => {
      await expect(service.enableTableRLS('public', 'bad"name')).rejects.toThrow(
        'Invalid table name: cannot contain quotes or control characters'
      );
      await expect(service.enableTableRLS('public', '')).rejects.toThrow(
        'Invalid table name: cannot be empty'
      );
    });

    it('rejects invalid schema identifier names with exact validation error', async () => {
      await expect(service.enableTableRLS('bad"schema', 'notes')).rejects.toThrow(
        'Invalid schema name: cannot contain quotes or control characters'
      );
      await expect(service.enableTableRLS('', 'notes')).rejects.toThrow(
        'Invalid schema name: cannot be empty'
      );
    });
  });

  describe('createTable RLS opt-out handling', () => {
    it('enables RLS by default when use_RLS is true', async () => {
      const response = await service.createTable(
        'public',
        'items',
        [{ columnName: 'name', type: 'string', isNullable: false, isUnique: false }],
        [],
        true
      );

      expect(response.rlsEnabled).toBe(true);

      const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
      const enableCall = sqlCalls.find((sql) =>
        sql.includes('ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;')
      );
      expect(enableCall).toBeDefined();

      const disableCall = sqlCalls.find((sql) =>
        sql.includes('ALTER TABLE "public"."items" DISABLE ROW LEVEL SECURITY;')
      );
      expect(disableCall).toBeUndefined();
    });

    it('explicitly disables RLS inside the transaction when use_RLS is false', async () => {
      const response = await service.createTable(
        'public',
        'public_feed',
        [{ columnName: 'content', type: 'string', isNullable: false, isUnique: false }],
        [],
        false
      );

      expect(response.rlsEnabled).toBe(false);

      const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
      const disableCall = sqlCalls.find((sql) =>
        sql.includes('ALTER TABLE "public"."public_feed" DISABLE ROW LEVEL SECURITY;')
      );
      expect(disableCall).toBeDefined();

      const commitIndex = sqlCalls.indexOf('COMMIT');
      const disableIndex = sqlCalls.findIndex((sql) =>
        sql.includes('ALTER TABLE "public"."public_feed" DISABLE ROW LEVEL SECURITY;')
      );
      // Ensure DISABLE is executed before COMMIT
      expect(disableIndex).toBeGreaterThan(-1);
      expect(commitIndex).toBeGreaterThan(disableIndex);
    });
  });
});
