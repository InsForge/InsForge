import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const { connectMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        connect: connectMock,
      })),
    })),
    clearColumnTypeCache: vi.fn(),
  },
}));

import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';
import { initSqlParser } from '../../src/utils/sql-parser';

describe('DatabaseAdvanceService - admin SQL execution', () => {
  beforeAll(async () => {
    await initSqlParser();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sanitizes raw SQL before opening a database connection', async () => {
    const service = DatabaseAdvanceService.getInstance();

    await expect(service.executeRawSQL('RESET ROLE')).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('executes raw SQL under project_admin and resets the pooled session', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // SET ROLE project_admin
      .mockResolvedValueOnce({}) // set request.jwt.claims
      .mockResolvedValueOnce({
        rows: [{ id: 1 }],
        rowCount: 1,
        fields: [{ name: 'id', dataTypeID: 23 }],
      }) // execute user SQL
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({}) // NOTIFY pgrst
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.executeRawSQL('CREATE TABLE public.products (id integer)', []);

    expect(result).toEqual({
      rows: [{ id: 1 }],
      rowCount: 1,
      fields: [{ name: 'id', dataTypeID: 23 }],
    });
    expect(queryMock).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 30000');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SET ROLE project_admin');
    expect(queryMock).toHaveBeenNthCalledWith(3, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      false,
    ]);
    expect(queryMock).toHaveBeenNthCalledWith(4, 'CREATE TABLE public.products (id integer)', []);
    expect(queryMock).toHaveBeenNthCalledWith(5, 'RESET ROLE');
    expect(queryMock).toHaveBeenNthCalledWith(6, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      '{}',
      false,
    ]);
    expect(queryMock).toHaveBeenNthCalledWith(7, `NOTIFY pgrst, 'reload schema';`);
    expect(queryMock).toHaveBeenNthCalledWith(8, 'SET statement_timeout = 0');
  });

  it('keeps unrestricted raw SQL on the root session', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({
        rows: [{ current_user: 'postgres' }],
        rowCount: 1,
        fields: [{ name: 'current_user', dataTypeID: 19 }],
      }) // execute user SQL
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.executeRawSQL('SELECT current_user', [], true);

    expect(result.rows).toEqual([{ current_user: 'postgres' }]);
    expect(queryMock).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 30000');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SELECT current_user', []);
    expect(queryMock).toHaveBeenNthCalledWith(3, 'SET statement_timeout = 0');
    expect(queryMock).not.toHaveBeenCalledWith('SET ROLE project_admin');
    expect(queryMock).not.toHaveBeenCalledWith('RESET ROLE');
  });

  it('returns healthy clients to the pool after ordinary SQL errors', async () => {
    const releaseMock = vi.fn();
    const queryError = new Error('syntax error');
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // SET ROLE project_admin
      .mockResolvedValueOnce({}) // set request.jwt.claims
      .mockRejectedValueOnce(queryError) // execute user SQL
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    await expect(service.executeRawSQL('SELECT broken')).rejects.toBe(queryError);

    expect(releaseMock).toHaveBeenCalledWith(undefined);
  });

  it('discards the pooled client when admin context cleanup fails', async () => {
    const releaseMock = vi.fn();
    const resetError = new Error('reset failed');
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // SET ROLE project_admin
      .mockResolvedValueOnce({}) // set request.jwt.claims
      .mockResolvedValueOnce({ rows: [], rowCount: 0, fields: [] }) // execute user SQL
      .mockRejectedValueOnce(resetError) // RESET ROLE
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    await expect(service.executeRawSQL('SELECT 1')).rejects.toBe(resetError);

    expect(releaseMock).toHaveBeenCalledWith(resetError);
  });

  it('imports SQL files under project_admin', async () => {
    const releaseMock = vi.fn();
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL ROLE project_admin
      .mockResolvedValueOnce({}) // set local request.jwt.claims
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // execute imported SQL
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({}) // NOTIFY pgrst
      .mockResolvedValueOnce({}); // COMMIT

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.importDatabase(
      Buffer.from('INSERT INTO products (id) VALUES (1);'),
      'seed.sql',
      36
    );

    expect(result.rowsImported).toBe(1);
    expect(queryMock).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SET LOCAL ROLE project_admin');
    expect(queryMock).toHaveBeenNthCalledWith(3, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      true,
    ]);
    expect(String(queryMock.mock.calls[3][0])).toContain('INSERT INTO products');
    expect(queryMock).toHaveBeenNthCalledWith(5, 'RESET ROLE');
    expect(queryMock).toHaveBeenNthCalledWith(6, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      '{}',
      true,
    ]);
    expect(queryMock).toHaveBeenNthCalledWith(7, `NOTIFY pgrst, 'reload schema';`);
    expect(queryMock).toHaveBeenNthCalledWith(8, 'COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('handles table truncate failures using savepoints in importDatabase', async () => {
    const releaseMock = vi.fn();
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL ROLE project_admin
      .mockResolvedValueOnce({}) // set local request.jwt.claims
      // For the SELECT tablename query:
      .mockResolvedValueOnce({
        rows: [{ tablename: 'table1' }, { tablename: 'table2' }],
      })
      // Truncate table1:
      .mockResolvedValueOnce({}) // SAVEPOINT truncate_attempt
      .mockRejectedValueOnce(new Error('Truncate table1 failed (mock locked)')) // TRUNCATE TABLE table1 CASCADE (FAILS)
      .mockResolvedValueOnce({}) // ROLLBACK TO SAVEPOINT truncate_attempt
      .mockResolvedValueOnce({}) // RELEASE SAVEPOINT truncate_attempt (after rollback)
      // Truncate table2:
      .mockResolvedValueOnce({}) // SAVEPOINT truncate_attempt
      .mockResolvedValueOnce({}) // TRUNCATE TABLE table2 CASCADE (SUCCEEDS)
      .mockResolvedValueOnce({}) // RELEASE SAVEPOINT truncate_attempt
      // SQL statements:
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // execute imported SQL
      // Reset context:
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({}) // NOTIFY pgrst
      .mockResolvedValueOnce({}); // COMMIT

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.importDatabase(
      Buffer.from('INSERT INTO products (id) VALUES (1);'),
      'seed.sql',
      36,
      true // truncate = true
    );

    expect(result.rowsImported).toBe(1);
    expect(queryMock).toHaveBeenCalledWith('SAVEPOINT truncate_attempt');
    expect(queryMock).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT truncate_attempt');
    expect(queryMock).toHaveBeenCalledWith('RELEASE SAVEPOINT truncate_attempt');
    expect(queryMock).toHaveBeenLastCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('bulk upserts under project_admin', async () => {
    const releaseMock = vi.fn();
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // 1. SET ROLE project_admin
      .mockResolvedValueOnce({}) // 2. set request.jwt.claims
      .mockResolvedValueOnce({}) // 3. BEGIN
      .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // 4. execute bulk upsert
      .mockResolvedValueOnce({}) // 5. NOTIFY pgrst
      .mockResolvedValueOnce({}) // 6. COMMIT
      .mockResolvedValueOnce({}) // 7. RESET ROLE
      .mockResolvedValueOnce({}); // 8. reset request.jwt.claims

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.bulkUpsertFromFile(
      'public',
      'profiles',
      Buffer.from('id,name\n1,Alice\n'),
      'profiles.csv',
      'id'
    );

    expect(result.rowsAffected).toBe(1);
    expect(queryMock).toHaveBeenNthCalledWith(1, 'SET ROLE project_admin');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      false,
    ]);
    expect(queryMock).toHaveBeenNthCalledWith(3, 'BEGIN');
    expect(String(queryMock.mock.calls[3][0])).toContain('INSERT INTO public.profiles');
    expect(String(queryMock.mock.calls[3][0])).toContain('ON CONFLICT (id) DO UPDATE');
    expect(queryMock).toHaveBeenNthCalledWith(5, `NOTIFY pgrst, 'reload schema';`);
    expect(queryMock).toHaveBeenNthCalledWith(6, 'COMMIT');
    expect(queryMock).toHaveBeenNthCalledWith(7, 'RESET ROLE');
    expect(queryMock).toHaveBeenNthCalledWith(8, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      '{}',
      false,
    ]);
    expect(releaseMock).toHaveBeenCalled();
  });

  it('executes explain under project_admin and rolls back the transaction', async () => {
    const releaseMock = vi.fn();
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // SET LOCAL ROLE project_admin
      .mockResolvedValueOnce({}) // set local request.jwt.claims
      .mockResolvedValueOnce({
        rows: [[{ Plan: { 'Node Type': 'Seq Scan' } }]],
        rowCount: 1,
      }) // execute explain SQL
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({}) // ROLLBACK
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    const result = await service.executeExplain('SELECT * FROM products', []);

    expect(queryMock).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 30000');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'BEGIN');
    expect(queryMock).toHaveBeenNthCalledWith(3, 'SET LOCAL ROLE project_admin');
    expect(queryMock).toHaveBeenNthCalledWith(4, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      true,
    ]);
    expect(queryMock.mock.calls[4][0]).toContain('EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) SELECT * FROM products');
    expect(queryMock).toHaveBeenNthCalledWith(6, 'RESET ROLE');
    expect(queryMock).toHaveBeenNthCalledWith(7, 'SELECT set_config($1, $2, $3)', [
      'request.jwt.claims',
      '{}',
      true,
    ]);
    expect(queryMock).toHaveBeenNthCalledWith(8, 'ROLLBACK');
    expect(queryMock).toHaveBeenNthCalledWith(9, 'SET statement_timeout = 0');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('executes explain as root and rolls back the transaction', async () => {
    const releaseMock = vi.fn();
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // SET statement_timeout
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [[{ Plan: { 'Node Type': 'Seq Scan' } }]],
        rowCount: 1,
      }) // execute explain SQL
      .mockResolvedValueOnce({}) // ROLLBACK
      .mockResolvedValueOnce({}); // reset statement_timeout

    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });

    const service = DatabaseAdvanceService.getInstance();
    await service.executeExplain('SELECT * FROM products', [], true);

    expect(queryMock).toHaveBeenNthCalledWith(1, 'SET statement_timeout = 30000');
    expect(queryMock).toHaveBeenNthCalledWith(2, 'BEGIN');
    expect(queryMock.mock.calls[2][0]).toContain('EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) SELECT * FROM products');
    expect(queryMock).toHaveBeenNthCalledWith(4, 'ROLLBACK');
    expect(queryMock).toHaveBeenNthCalledWith(5, 'SET statement_timeout = 0');
    expect(queryMock).not.toHaveBeenCalledWith('SET ROLE project_admin');
    expect(queryMock).not.toHaveBeenCalledWith('RESET ROLE');
    expect(releaseMock).toHaveBeenCalled();
  });
});
