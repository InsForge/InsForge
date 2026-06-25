import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/utils/errors';

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
  },
}));

import { AdminRecordService } from '../../src/services/database/admin-record.service';

describe('AdminRecordService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: releaseMock,
    });
  });

  it('reads protected-schema records through direct SQL with search and sorting', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            { column_name: 'email', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('COUNT(*)::text AS total')) {
        return { rows: [{ total: '2' }] };
      }
      if (sql.includes('SELECT * FROM "auth"."users"')) {
        return {
          rows: [
            { id: '1', email: 'demo-1@example.com' },
            { id: '2', email: 'demo-2@example.com' },
          ],
        };
      }
      return { rows: [] };
    });

    const service = AdminRecordService.getInstance();
    const result = await service.listRecords('auth', 'users', {
      limit: 10,
      offset: 0,
      search: 'demo',
      sort: [{ columnName: 'email', direction: 'asc' }],
    });

    expect(result.total).toBe(2);
    expect(result.records).toHaveLength(2);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const beginIndex = sqlCalls.indexOf('BEGIN');
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const dataQueryIndex = sqlCalls.findIndex((sql) =>
      sql.includes('ORDER BY "email" ASC LIMIT $2 OFFSET $3')
    );
    const resetRoleIndex = sqlCalls.indexOf('RESET ROLE');
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(beginIndex).toBe(0);
    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(dataQueryIndex).toBeGreaterThan(setRoleIndex);
    expect(resetRoleIndex).toBeGreaterThan(dataQueryIndex);
    expect(commitIndex).toBeGreaterThan(resetRoleIndex);
    expect(clientQueryMock.mock.calls[dataQueryIndex]?.[1]).toEqual(['%demo%', 10, 0]);
  });

  it('delegates protected-schema writes to project_admin privileges', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL ROLE
      .mockResolvedValueOnce({}) // set request.jwt.claims
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
          { column_name: 'email', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
        ],
      }) // metadata
      .mockResolvedValueOnce({
        rows: [{ id: 'u1', email: 'demo@example.com' }],
      }) // INSERT
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset config
      .mockResolvedValueOnce({}); // COMMIT

    const service = AdminRecordService.getInstance();
    const result = await service.createRecords('auth', 'users', [{ email: 'demo@example.com' }]);

    expect(result).toEqual([{ id: 'u1', email: 'demo@example.com' }]);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const insertIndex = sqlCalls.findIndex((sql) => sql.includes('INSERT INTO "auth"."users"'));
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(sqlCalls[0]).toBe('BEGIN');
    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(setRoleIndex);
    expect(commitIndex).toBeGreaterThan(insertIndex);
  });

  it('updates public records and converts blank nullable uuid values to null', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            { column_name: 'owner_id', data_type: 'uuid', is_nullable: 'YES', udt_name: 'uuid' },
            { column_name: 'name', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('UPDATE "public"."projects"')) {
        return {
          rows: [{ id: 'p1', owner_id: null, name: 'Renamed project' }],
        };
      }
      return { rows: [] };
    });

    const service = AdminRecordService.getInstance();
    const record = await service.updateRecord(
      'public',
      'projects',
      { id: 'p1' },
      {
        owner_id: '',
        name: 'Renamed project',
      }
    );

    expect(record).toEqual({ id: 'p1', owner_id: null, name: 'Renamed project' });
    const updateCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE "public"."projects"')
    );
    expect(updateCall?.[0]).toContain(
      'SET "owner_id" = $1, "name" = $2 WHERE "id" = $3 RETURNING *'
    );
    expect(updateCall?.[1]).toEqual([null, 'Renamed project', 'p1']);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const updateIndex = sqlCalls.findIndex((sql) => sql.includes('UPDATE "public"."projects"'));
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(sqlCalls[0]).toBe('BEGIN');
    expect(setRoleIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(setRoleIndex);
    expect(commitIndex).toBeGreaterThan(updateIndex);
  });

  it('preserves empty strings for character varying inserts', async () => {
    clientQueryMock
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL ROLE
      .mockResolvedValueOnce({}) // set_config
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
          {
            column_name: 'name',
            data_type: 'character varying',
            is_nullable: 'YES',
            udt_name: 'varchar',
          },
        ],
      }) // metadata
      .mockResolvedValueOnce({
        rows: [{ id: 'r1', name: '' }],
      }) // INSERT
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset config
      .mockResolvedValueOnce({}); // COMMIT

    const service = AdminRecordService.getInstance();
    const result = await service.createRecords('public', 'projects', [{ name: '' }]);

    expect(result).toEqual([{ id: 'r1', name: '' }]);
    const insertCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO "public"."projects"')
    );
    expect(insertCall?.[1]).toEqual(['']);
  });

  it('converts blank updates on nullable non-text columns to null', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            {
              column_name: 'priority',
              data_type: 'integer',
              is_nullable: 'YES',
              udt_name: 'int4',
            },
          ],
        };
      }
      if (sql.includes('UPDATE "public"."projects"')) {
        return {
          rows: [{ id: 'p1', priority: null }],
        };
      }
      return { rows: [] };
    });

    const service = AdminRecordService.getInstance();
    const record = await service.updateRecord(
      'public',
      'projects',
      { id: 'p1' },
      {
        priority: '',
      }
    );

    expect(record).toEqual({ id: 'p1', priority: null });
    const updateCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE "public"."projects"')
    );
    expect(updateCall?.[1]).toEqual([null, 'p1']);
  });

  it('rejects blank updates on required non-text columns with a 400', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            {
              column_name: 'priority',
              data_type: 'integer',
              is_nullable: 'NO',
              udt_name: 'int4',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const service = AdminRecordService.getInstance();

    await expect(
      service.updateRecord(
        'public',
        'projects',
        { id: 'p1' },
        {
          priority: '',
        }
      )
    ).rejects.toBeInstanceOf(AppError);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    expect(sqlCalls).toContain('ROLLBACK');
  });

  it('deletes records inside a project_admin transaction', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            { column_name: 'name', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('DELETE FROM "public"."projects"')) {
        return { rowCount: 2, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const service = AdminRecordService.getInstance();
    const deletedCount = await service.deleteRecords('public', 'projects', [
      { id: 'p1' },
      { id: 'p2' },
    ]);

    expect(deletedCount).toBe(2);

    const sqlCalls = clientQueryMock.mock.calls.map(([sql]) => sql as string);
    const setRoleIndex = sqlCalls.indexOf('SET LOCAL ROLE project_admin');
    const deleteIndex = sqlCalls.findIndex((sql) =>
      sql.includes('DELETE FROM "public"."projects"')
    );
    const commitIndex = sqlCalls.indexOf('COMMIT');

    expect(sqlCalls[0]).toBe('BEGIN');
    expect(deleteIndex).toBeGreaterThan(setRoleIndex);
    expect(commitIndex).toBeGreaterThan(deleteIndex);
  });

  it('updates a composite-key row using the full primary-key tuple', async () => {
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
      if (sql.includes('UPDATE "public"."composite_pk_test"')) {
        return {
          rows: [{ tenant_id: 'tenant_a', item_id: 'item_2', label: 'second-updated' }],
        };
      }
      return { rows: [] };
    });

    const service = AdminRecordService.getInstance();
    const record = await service.updateRecord(
      'public',
      'composite_pk_test',
      { tenant_id: 'tenant_a', item_id: 'item_2' },
      { label: 'second-updated' }
    );

    expect(record).toEqual({ tenant_id: 'tenant_a', item_id: 'item_2', label: 'second-updated' });

    const updateCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE "public"."composite_pk_test"')
    );
    // The WHERE clause must match both key columns, not just the (duplicated) first one.
    expect(updateCall?.[0]).toContain(
      'SET "label" = $1 WHERE "tenant_id" = $2 AND "item_id" = $3 RETURNING *'
    );
    expect(updateCall?.[1]).toEqual(['second-updated', 'tenant_a', 'item_2']);
  });

  it('deletes only the selected composite-key tuples', async () => {
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
      if (sql.includes('DELETE FROM "public"."composite_pk_test"')) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const service = AdminRecordService.getInstance();
    // tenant_a is duplicated across rows; deleting must target the exact tuple only.
    const deletedCount = await service.deleteRecords('public', 'composite_pk_test', [
      { tenant_id: 'tenant_a', item_id: 'item_2' },
    ]);

    expect(deletedCount).toBe(1);

    const deleteCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM "public"."composite_pk_test"')
    );
    expect(deleteCall?.[0]).toContain('WHERE ("tenant_id" = $1 AND "item_id" = $2)');
    expect(deleteCall?.[1]).toEqual(['tenant_a', 'item_2']);
  });

  it('matches each selected composite tuple independently when deleting many rows', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'tenant_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
            { column_name: 'item_id', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('DELETE FROM "public"."composite_pk_test"')) {
        return { rowCount: 2, rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    const service = AdminRecordService.getInstance();
    const deletedCount = await service.deleteRecords('public', 'composite_pk_test', [
      { tenant_id: 'tenant_a', item_id: 'item_1' },
      { tenant_id: 'tenant_a', item_id: 'item_2' },
    ]);

    expect(deletedCount).toBe(2);

    const deleteCall = clientQueryMock.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('DELETE FROM "public"."composite_pk_test"')
    );
    expect(deleteCall?.[0]).toContain(
      'WHERE ("tenant_id" = $1 AND "item_id" = $2) OR ("tenant_id" = $3 AND "item_id" = $4)'
    );
    expect(deleteCall?.[1]).toEqual(['tenant_a', 'item_1', 'tenant_a', 'item_2']);
  });

  it('discards the pooled client when admin transaction cleanup fails', async () => {
    const resetError = new Error('reset failed');

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM information_schema.columns')) {
        return {
          rows: [
            { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', udt_name: 'uuid' },
            { column_name: 'name', data_type: 'text', is_nullable: 'NO', udt_name: 'text' },
          ],
        };
      }
      if (sql.includes('UPDATE "public"."projects"')) {
        return { rows: [{ id: 'p1', name: 'Renamed project' }] };
      }
      if (sql === 'RESET ROLE') {
        throw resetError;
      }
      return { rows: [], rowCount: 0 };
    });

    const service = AdminRecordService.getInstance();

    await expect(
      service.updateRecord(
        'public',
        'projects',
        { id: 'p1' },
        {
          name: 'Renamed project',
        }
      )
    ).rejects.toBe(resetError);

    expect(clientQueryMock.mock.calls.map(([sql]) => sql as string)).toContain('ROLLBACK');
    expect(releaseMock).toHaveBeenCalledWith(resetError);
  });
});
