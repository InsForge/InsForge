import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Pool } from 'pg';
import { DatabaseBrowseService } from '../../src/services/database/database-browse.service';
import { DatabaseManager } from '../../src/infra/database/database.manager';
import { AppError } from '../../src/api/middlewares/error';
import { ColumnType, guardedValueDisplayText, guardedValueFlag } from '@insforge/shared-schemas';

type ServiceState = {
  pool: Pool | null;
  tableService: {
    getTableSchema: ReturnType<typeof vi.fn>;
  };
};

describe('database browse route authentication', () => {
  const browseSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/browse.routes.ts'),
    'utf-8'
  );

  test('applies verifyAdmin middleware to the dedicated browse route', () => {
    expect(browseSource).toContain('import { AuthRequest, verifyAdmin }');
    expect(browseSource).toMatch(/router\.use\(\s*verifyAdmin\s*\)/);
  });

  test('is mounted separately from records routes', () => {
    const indexSource = readFileSync(
      resolve(__dirname, '../../src/api/routes/database/index.routes.ts'),
      'utf-8'
    );

    expect(indexSource).toContain("router.use('/browse', databaseBrowseRouter);");
  });
});

describe('DatabaseBrowseService', () => {
  const service = DatabaseBrowseService.getInstance();
  const serviceState = service as unknown as ServiceState;
  const originalPool = serviceState.pool;
  const originalTableService = serviceState.tableService;

  beforeEach(() => {
    serviceState.tableService = {
      getTableSchema: vi.fn().mockResolvedValue({
        tableName: 'big_test',
        columns: [
          { columnName: 'id', type: ColumnType.UUID },
          { columnName: 'name', type: ColumnType.STRING },
          { columnName: 'payload', type: ColumnType.JSON },
          { columnName: 'blob', type: 'bytea' },
          { columnName: 'created_at', type: ColumnType.DATETIME },
        ],
        recordCount: 4,
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    serviceState.pool = originalPool;
    serviceState.tableService = originalTableService;
  });

  test('builds guarded queries with typed size checks and escaped search', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 4 }] })
      .mockResolvedValueOnce({ rows: [{ row_data: { id: '1' } }] });

    serviceState.pool = { query } as unknown as Pool;

    vi.spyOn(DatabaseManager, 'getColumnTypeMap').mockResolvedValue({
      id: 'uuid',
      name: 'text',
      payload: 'jsonb',
      blob: 'bytea',
      created_at: 'timestamp with time zone',
    });

    await service.browseTable('big_test', {
      limit: 5000,
      offset: 2,
      order: 'name.desc',
      search: '50%_match',
    });

    expect(query).toHaveBeenCalledTimes(2);

    const [countSql, countParams] = query.mock.calls[0] as [string, string[]];
    const [dataSql, dataParams] = query.mock.calls[1] as [string, string[]];

    expect(countSql).toContain('COUNT(*)::int AS total');
    expect(countSql).toContain(`ILIKE $1 ESCAPE '\\'`);
    expect(countParams).toEqual(['%50\\%\\_match%']);

    expect(dataSql).toContain(`'name', CASE`);
    expect(dataSql).toContain(`octet_length(t."name")`);
    expect(dataSql).toContain(`octet_length(t."payload"::text)`);
    expect(dataSql).toContain(`octet_length(t."blob")`);
    expect(dataSql).toContain(
      `jsonb_build_object('${guardedValueFlag}', true, 'message', '${guardedValueDisplayText}')`
    );
    expect(dataSql).toContain('ORDER BY t."name" DESC');
    expect(dataSql).toContain('LIMIT 1000');
    expect(dataSql).toContain('OFFSET 2');
    expect(dataParams).toEqual(['%50\\%\\_match%']);
  });

  test('uses safe default ordering when created_at is missing', async () => {
    serviceState.tableService = {
      getTableSchema: vi.fn().mockResolvedValue({
        tableName: 'simple_table',
        columns: [
          { columnName: 'id', type: ColumnType.UUID },
          { columnName: 'title', type: ColumnType.STRING },
        ],
        recordCount: 1,
      }),
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ row_data: { id: '1', title: 'ok' } }] });

    serviceState.pool = { query } as unknown as Pool;

    vi.spyOn(DatabaseManager, 'getColumnTypeMap').mockResolvedValue({
      id: 'uuid',
      title: 'text',
    });

    await service.browseTable('simple_table', {});

    const [dataSql] = query.mock.calls[1] as [string];
    expect(dataSql).toContain('ORDER BY t."id" DESC');
  });

  test('rejects invalid sort columns', async () => {
    vi.spyOn(DatabaseManager, 'getColumnTypeMap').mockResolvedValue({
      id: 'uuid',
      name: 'text',
      payload: 'jsonb',
      blob: 'bytea',
      created_at: 'timestamp with time zone',
    });

    await expect(
      service.browseTable('big_test', {
        order: 'missing.asc',
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  test('does not bind a search placeholder when the table has no text columns', async () => {
    serviceState.tableService = {
      getTableSchema: vi.fn().mockResolvedValue({
        tableName: 'binary_table',
        columns: [
          { columnName: 'id', type: ColumnType.UUID },
          { columnName: 'blob', type: 'bytea' },
        ],
        recordCount: 1,
      }),
    };

    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ row_data: { id: '1' } }] });

    serviceState.pool = { query } as unknown as Pool;

    vi.spyOn(DatabaseManager, 'getColumnTypeMap').mockResolvedValue({
      id: 'uuid',
      blob: 'bytea',
    });

    await service.browseTable('binary_table', { search: 'abc' });

    const [, countParams] = query.mock.calls[0] as [string, string[]];
    const [, dataParams] = query.mock.calls[1] as [string, string[]];
    expect(countParams).toEqual([]);
    expect(dataParams).toEqual([]);
  });
});
