import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connectMock, parseSQLStatementsMock, initSqlParserMock, checkSqlExecutionGuardsMock } =
  vi.hoisted(() => ({
    connectMock: vi.fn(),
    parseSQLStatementsMock: vi.fn((sql: string) => [sql]),
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
  analyzeQuery: vi.fn(() => []),
  initSqlParser: initSqlParserMock,
  checkSqlExecutionGuards: checkSqlExecutionGuardsMock,
}));

import { DatabaseMigrationService } from '../../src/services/database/database-migration.service.js';

describe('DatabaseMigrationService Dry-Run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluates safe DDL statements in a dry-run', async () => {
    const queryMock = vi.fn().mockResolvedValue({});
    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseMigrationService.getInstance();
    const result = await service.dryRunMigration({
      sql: 'CREATE TABLE public.test_items (id uuid PRIMARY KEY)',
    });

    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe('SAFE');
    expect(result.statementCount).toBe(1);
    expect(result.riskFactors).toHaveLength(0);
  });

  it('detects destructive DANGER statements in a dry-run', async () => {
    const queryMock = vi.fn().mockResolvedValue({});
    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseMigrationService.getInstance();
    const result = await service.dryRunMigration({
      sql: 'DROP TABLE public.legacy_users',
    });

    expect(result.valid).toBe(true);
    expect(result.riskLevel).toBe('DANGER');
    expect(result.riskFactors).toHaveLength(1);
    expect(result.riskFactors[0].code).toBe('DESTRUCTIVE_DATA_LOSS');
  });

  it('handles execution errors and flags them as DANGER', async () => {
    const queryMock = vi.fn().mockImplementation((queryText: string) => {
      if (typeof queryText === 'string' && queryText.includes('INVALID SQL STATEMENT')) {
        return Promise.reject(new Error('syntax error at or near INVALID'));
      }
      return Promise.resolve({});
    });

    connectMock.mockResolvedValue({
      query: queryMock,
      release: vi.fn(),
    });

    const service = DatabaseMigrationService.getInstance();
    const result = await service.dryRunMigration({
      sql: 'INVALID SQL STATEMENT',
    });

    expect(result.valid).toBe(false);
    expect(result.riskLevel).toBe('DANGER');
    expect(result.error).toContain('syntax error');
    expect(queryMock).toHaveBeenCalledWith('INVALID SQL STATEMENT');
  });
});
