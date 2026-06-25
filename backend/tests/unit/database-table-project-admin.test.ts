import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ColumnType } from '@insforge/shared-schemas';
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
  },
}));

describe('DatabaseTableService project_admin DDL context', () => {
  let service: DatabaseTableService;
  let tableExists = false;

  beforeEach(() => {
    vi.clearAllMocks();
    tableExists = false;
    service = DatabaseTableService.getInstance();

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT EXISTS')) {
        return { rows: [{ exists: tableExists }], rowCount: 1 };
      }

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
            {
              column_name: 'title',
              data_type: 'text',
              udt_name: 'text',
              is_nullable: 'YES',
              column_default: null,
              character_maximum_length: null,
            },
          ],
          rowCount: 2,
        };
      }

      if (sql.includes("tc.constraint_type = 'FOREIGN KEY'")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("AND constraint_type = 'PRIMARY KEY'")) {
        return { rows: [{ column_name: 'id' }], rowCount: 1 };
      }

      if (sql.includes("AND tc.constraint_type = 'UNIQUE'")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('COUNT(*) as row_count')) {
        return { rows: [{ row_count: '0' }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });
  });

  it('creates dashboard tables as project_admin', async () => {
    await service.createTable(
      'public',
      'posts',
      [{ columnName: 'title', type: ColumnType.STRING, isNullable: false }],
      [],
      true
    );

    const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const createTableIndex = sqlCalls.findIndex((sql) =>
      sql.includes('CREATE TABLE "public"."posts"')
    );
    const resetRoleIndex = sqlCalls.indexOf('RESET ROLE');
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(createTableIndex).toBeGreaterThan(setRoleIndex);
    expect(resetRoleIndex).toBeGreaterThan(createTableIndex);
    expect(commitIndex).toBeGreaterThan(resetRoleIndex);
  });

  it('updates dashboard table schema as project_admin', async () => {
    tableExists = true;

    await service.updateTableSchema('public', 'posts', {
      addColumns: [{ columnName: 'summary', type: ColumnType.STRING, isNullable: true }],
    });

    const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const alterTableIndex = sqlCalls.findIndex(
      (sql) => sql.includes('ALTER TABLE "public"."posts"') && sql.includes('ADD COLUMN "summary"')
    );
    const resetRoleIndex = sqlCalls.indexOf('RESET ROLE');
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(alterTableIndex).toBeGreaterThan(setRoleIndex);
    expect(resetRoleIndex).toBeGreaterThan(alterTableIndex);
    expect(commitIndex).toBeGreaterThan(resetRoleIndex);
  });

  it('deletes dashboard tables as project_admin', async () => {
    await service.deleteTable('public', 'posts');

    const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const dropTableIndex = sqlCalls.findIndex((sql) =>
      sql.includes('DROP TABLE IF EXISTS "public"."posts" CASCADE')
    );
    const resetRoleIndex = sqlCalls.indexOf('RESET ROLE');
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(dropTableIndex).toBeGreaterThan(setRoleIndex);
    expect(resetRoleIndex).toBeGreaterThan(dropTableIndex);
    expect(commitIndex).toBeGreaterThan(resetRoleIndex);
  });

  it('delegates protected-schema create attempts to project_admin privileges', async () => {
    await service.createTable(
      'auth',
      'users_copy',
      [{ columnName: 'email', type: ColumnType.STRING, isNullable: false }],
      [],
      true
    );

    const sqlCalls = queryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const createTableIndex = sqlCalls.findIndex((sql) =>
      sql.includes('CREATE TABLE "auth"."users_copy"')
    );

    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(createTableIndex).toBeGreaterThan(setRoleIndex);
  });
});
