import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '../../src/types/error-constants';

const {
  connectMock,
  parseSQLStatementsMock,
  analyzeQueryMock,
  initSqlParserMock,
  checkManagedSchemaWriteOperationsMock,
  checkAuthSchemaOperationsMock,
  checkSystemSchemaOperationsMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  parseSQLStatementsMock: vi.fn((sql: string) => [sql]),
  analyzeQueryMock: vi.fn(() => []),
  initSqlParserMock: vi.fn(async () => {}),
  checkManagedSchemaWriteOperationsMock: vi.fn((query: string) =>
    query.includes('auth.users')
      ? 'Write operations on auth schema are not allowed. InsForge-managed schemas are protected in the dashboard.'
      : null
  ),
  checkAuthSchemaOperationsMock: vi.fn(() => null),
  checkSystemSchemaOperationsMock: vi.fn(() => null),
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
  checkManagedSchemaWriteOperations: checkManagedSchemaWriteOperationsMock,
  checkAuthSchemaOperations: checkAuthSchemaOperationsMock,
  checkSystemSchemaOperations: checkSystemSchemaOperationsMock,
}));

vi.mock('libpg-query', () => ({
  parseSync: vi.fn(() => ({
    stmts: [{ stmt: { CreateStmt: {} } }],
  })),
}));

import { DatabaseMigrationService } from '../../src/services/database/database-migration.service';

describe('DatabaseMigrationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks protected schema migrations before opening a database transaction', async () => {
    const service = DatabaseMigrationService.getInstance();

    await expect(
      service.createMigration({
        version: '202605020001',
        name: 'protected-write',
        sql: "INSERT INTO auth.users (email) VALUES ('demo@example.com')",
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.FORBIDDEN,
    });

    expect(checkManagedSchemaWriteOperationsMock).toHaveBeenCalledWith(
      "INSERT INTO auth.users (email) VALUES ('demo@example.com')"
    );
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('reloads only the PostgREST schema cache after an allowed migration', async () => {
    const queryMock = vi
      .fn()
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // advisory lock
      .mockResolvedValueOnce({}) // search_path
      .mockResolvedValueOnce({ rows: [] }) // latest version
      .mockResolvedValueOnce({}) // execute migration SQL
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
    expect(queryMock).toHaveBeenCalledWith(`NOTIFY pgrst, 'reload schema';`);
    expect(queryMock).not.toHaveBeenCalledWith(`NOTIFY pgrst, 'reload config';`);
  });
});
