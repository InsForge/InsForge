import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const {
  connectMock,
  parseSQLStatementsMock,
  analyzeQueryMock,
  initSqlParserMock,
  checkSqlExecutionGuardsMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  parseSQLStatementsMock: vi.fn((sql: string) => [sql]),
  analyzeQueryMock: vi.fn(() => []),
  initSqlParserMock: vi.fn(async () => {}),
  checkSqlExecutionGuardsMock: vi.fn((query: string) =>
    query.includes('RESET ROLE')
      ? 'Changing SQL execution role or session authorization is not allowed.'
      : null
  ),
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

vi.mock('../../src/utils/sql-parser', () => ({
  parseSQLStatements: parseSQLStatementsMock,
  analyzeQuery: analyzeQueryMock,
  initSqlParser: initSqlParserMock,
  checkSqlExecutionGuards: checkSqlExecutionGuardsMock,
}));

import { DatabaseMigrationService } from '../../src/services/database/database-migration.service';

describe('DatabaseMigrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks execution context changes before opening a database transaction', async () => {
    const service = DatabaseMigrationService.getInstance();

    await expect(
      service.createMigration({
        version: '202605020001',
        name: 'role-reset',
        sql: 'RESET ROLE',
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });

    expect(checkSqlExecutionGuardsMock).toHaveBeenCalledWith('RESET ROLE');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('reloads only the PostgREST schema cache after an allowed migration', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({}) // search_path
      .mockResolvedValueOnce({ rows: [] }) // latest version
      .mockResolvedValueOnce({}) // SET ROLE project_admin
      .mockResolvedValueOnce({}) // set request.jwt.claims
      .mockResolvedValueOnce({}) // execute migration SQL
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}) // reset request.jwt.claims
      .mockResolvedValueOnce({
        rows: [
          {
            version: '202605020002',
            name: 'create-products',
            statements: ['CREATE TABLE public.products (id uuid)'],
            createdAt: '2026-05-02T00:00:00.000Z',
          },
        ],
      }) // insert custom_migrations row
      .mockResolvedValueOnce({}) // reload schema
      .mockResolvedValueOnce({}); // COMMIT

    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseMigrationService.getInstance();
    const result = await service.createMigration({
      version: '202605020002',
      name: 'create-products',
      sql: 'CREATE TABLE public.products (id uuid)',
    });

    expect(result.migration.version).toBe('202605020002');
    expect(queryMock).toHaveBeenCalledWith('SET ROLE project_admin');
    expect(queryMock).toHaveBeenCalledWith('RESET ROLE');
    expect(queryMock).toHaveBeenCalledWith(`NOTIFY pgrst, 'reload schema';`);
    expect(queryMock).not.toHaveBeenCalledWith(`NOTIFY pgrst, 'reload config';`);
  });
});
