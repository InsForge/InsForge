import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';

describe('DatabaseAdvanceService - sanitizeQuery', () => {
  const service = DatabaseAdvanceService.getInstance();

  test('blocks database-level operations', () => {
    const queries = [
      'DROP DATABASE customer_project',
      'CREATE DATABASE customer_project',
      'ALTER DATABASE customer_project SET timezone TO UTC',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('blocks role and session authorization management', () => {
    const queries = [
      'SET ROLE postgres',
      'SET LOCAL ROLE postgres',
      'RESET ROLE',
      'SET SESSION AUTHORIZATION postgres',
      'RESET SESSION AUTHORIZATION',
      'RESET ALL',
      'SET search_path TO public',
      "SELECT set_config('search_path', 'public', false)",
      'SET statement_timeout = 0',
      'RESET statement_timeout',
      'CREATE ROLE app_owner',
      'ALTER ROLE project_admin SET search_path TO public',
      'DROP ROLE app_owner',
      'GRANT postgres TO project_admin',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('blocks transaction control in raw SQL', () => {
    const queries = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT before_change'];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('throws AppError with 403 FORBIDDEN for execution context violations', () => {
    try {
      service.sanitizeQuery('RESET ROLE');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
        expect(error.message).toContain('execution role');
      }
    }
  });

  test('allows managed schema statements to be decided by project_admin database grants', () => {
    const queries = [
      "INSERT INTO auth.users (email, password_hash) VALUES ('demo@example.com', 'hash')",
      'CREATE TRIGGER user_profile_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_user_profile()',
      'SELECT * FROM pg_catalog.pg_class LIMIT 1',
      "INSERT INTO storage.objects (bucket_id, key, name) VALUES ('avatars', 'u1/a.png', 'a.png')",
      'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY',
      "UPDATE payments.customers SET email = 'new@example.com' WHERE id = 'cus_123'",
      "INSERT INTO system.custom_migrations (version, name, statements) VALUES ('1', 'manual', ARRAY['SELECT 1'])",
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    }
  });

  test('allows public schema DDL and grants', () => {
    const queries = [
      'CREATE TABLE public.products (id uuid PRIMARY KEY)',
      'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY',
      'CREATE POLICY products_select ON public.products FOR SELECT TO authenticated USING (true)',
      'GRANT SELECT ON public.products TO authenticated',
      'DROP POLICY products_select ON public.products',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkInsert — optional-column data-loss fix (issue #8)
// ─────────────────────────────────────────────────────────────────────────────

const { mockClientQuery, mockRelease, mockConnect } = vi.hoisted(() => ({
  mockClientQuery: vi.fn(),
  mockRelease: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        query: vi.fn(),
        connect: mockConnect,
      })),
    })),
  },
}));

describe('DatabaseAdvanceService - bulkInsert optional-column fix', () => {
  type BulkInsertType = (
    schemaName: string,
    table: string,
    records: Record<string, unknown>[],
    upsertKey?: string
  ) => Promise<{ rowCount: number; rows?: unknown[] }>;

  beforeEach(() => {
    vi.clearAllMocks();
    // pool.connect() returns a pg client with query + release
    mockConnect.mockResolvedValue({
      query: mockClientQuery,
      release: mockRelease,
    });
    // Default: all queries succeed
    mockClientQuery.mockResolvedValue({ rows: [], rowCount: 2 });
  });

  /** Helper: find all INSERT SQL queries executed */
  function captureAllInsertSql(): string[] {
    return mockClientQuery.mock.calls
      .map(([sql]) => sql as string)
      .filter((sql) => typeof sql === 'string' && sql.startsWith('INSERT INTO'));
  }

  test('groups records by shape and executes shape-coherent batch queries', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob', phone: '555-0001' },
      { id: '3', name: 'Carol', phone: '555-0002' },
    ]);

    const sqlQueries = captureAllInsertSql();
    expect(sqlQueries).toHaveLength(2);

    // First query (Alice) has no phone
    const query1 = sqlQueries[0];
    expect(query1).toContain('id');
    expect(query1).toContain('name');
    expect(query1).not.toContain('phone');
    expect(query1).toContain('Alice');

    // Second query (Bob and Carol) has phone
    const query2 = sqlQueries[1];
    expect(query2).toContain('id');
    expect(query2).toContain('name');
    expect(query2).toContain('phone');
    expect(query2).toContain('555-0001');
    expect(query2).toContain('555-0002');
  });

  test('explicit undefined values are converted to NULL', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice', phone: undefined },
    ]);

    const sqlQueries = captureAllInsertSql();
    expect(sqlQueries).toHaveLength(1);
    expect(sqlQueries[0]).toContain('phone');
    expect(sqlQueries[0]).not.toContain('undefined');
    expect(sqlQueries[0]).toContain('NULL');
  });

  test('uniform records (all same columns) still work correctly', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice', phone: '555-0001' },
      { id: '2', name: 'Bob', phone: '555-0002' },
    ]);

    const sqlQueries = captureAllInsertSql();
    expect(sqlQueries).toHaveLength(1);
    const sql = sqlQueries[0];
    expect(sql).toContain('id');
    expect(sql).toContain('name');
    expect(sql).toContain('phone');
    expect(sql).toContain('555-0001');
    expect(sql).toContain('555-0002');
  });

  test('throws AppError when records array is empty', async () => {
    const svc = DatabaseAdvanceService.getInstance();
    await expect(
      (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', [])
    ).rejects.toBeInstanceOf(AppError);
  });

  test('upsert: optional column from later records is included in ON CONFLICT SET for its group', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert(
      'public',
      'contacts',
      [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob', phone: '555-0001' },
      ],
      'id'
    );

    const sqlQueries = captureAllInsertSql();
    expect(sqlQueries).toHaveLength(2);

    const query1 = sqlQueries[0]; // Alice: keys ['id', 'name']
    expect(query1).toContain('ON CONFLICT');
    expect(query1).toContain('DO UPDATE SET');
    expect(query1).toContain('name = EXCLUDED.name');
    expect(query1).not.toContain('phone');

    const query2 = sqlQueries[1]; // Bob: keys ['id', 'name', 'phone']
    expect(query2).toContain('ON CONFLICT');
    expect(query2).toContain('DO UPDATE SET');
    expect(query2).toContain('name = EXCLUDED.name');
    expect(query2).toContain('phone = EXCLUDED.phone');
  });

  test('explicit null values are preserved in the SQL', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice', phone: null },
    ]);

    const sqlQueries = captureAllInsertSql();
    expect(sqlQueries).toHaveLength(1);
    expect(sqlQueries[0]).toContain('phone');
    expect(sqlQueries[0]).toContain('NULL');
  });

  test('rolls back entire transaction if one shape group insert fails', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    mockClientQuery.mockReset();
    mockClientQuery
      .mockResolvedValueOnce({}) // SET ROLE project_admin
      .mockResolvedValueOnce({}) // set_config claims
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // First INSERT (Alice)
      .mockRejectedValueOnce(new Error('Constraint violation on second group')) // Second INSERT (Bob)
      .mockResolvedValueOnce({}) // ROLLBACK
      .mockResolvedValueOnce({}) // RESET ROLE
      .mockResolvedValueOnce({}); // set_config empty claims

    const records = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob', phone: '555-0001' },
    ];

    await expect(
      (svc as unknown as { bulkInsert: BulkInsertType }).bulkInsert('public', 'contacts', records)
    ).rejects.toThrow('Constraint violation on second group');

    const calls = mockClientQuery.mock.calls.map(([sql]) => sql);
    expect(calls).toContain('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stream Database Export Tests (JSON transforms, connection integrity, leaks)
// ─────────────────────────────────────────────────────────────────────────────

import { Readable, Writable } from 'stream';
import {
  JsonExportTransform,
  CsvExportTransform,
  SqlExportTransform,
} from '../../src/utils/export-streams';

describe('DatabaseAdvanceService - Stream Export Transform Streams', () => {
  test('JsonExportTransform processes rows and wraps them in a valid JSON array', async () => {
    const transform = new JsonExportTransform();
    let result = '';

    const writer = new Writable({
      write(chunk, encoding, callback) {
        result += chunk.toString();
        callback();
      },
    });

    transform.pipe(writer);
    transform.write({ id: 1, name: 'Alice' });
    transform.write({ id: 2, name: 'Bob' });
    transform.end();

    await new Promise((resolve) => writer.on('finish', resolve));

    expect(result).toBe('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]');
  });

  test('JsonExportTransform outputs exactly [] when receiving 0 rows', async () => {
    const transform = new JsonExportTransform();
    let result = '';

    const writer = new Writable({
      write(chunk, encoding, callback) {
        result += chunk.toString();
        callback();
      },
    });

    transform.pipe(writer);
    transform.end();

    await new Promise((resolve) => writer.on('finish', resolve));

    expect(result).toBe('[]');
  });

  test('CsvExportTransform extracts headers and format values correctly', async () => {
    const transform = new CsvExportTransform();
    let result = '';

    const writer = new Writable({
      write(chunk, encoding, callback) {
        result += chunk.toString();
        callback();
      },
    });

    transform.pipe(writer);
    transform.write({ id: 1, name: 'Alice', bio: 'a, b\n' });
    transform.write({ id: 2, name: 'Bob', bio: 'no quotes' });
    transform.end();

    await new Promise((resolve) => writer.on('finish', resolve));

    expect(result).toBe('id,name,bio\n1,Alice,"a, b\n"\n2,Bob,no quotes\n');
  });

  test('SqlExportTransform produces correct INSERT statements', async () => {
    const transform = new SqlExportTransform('users');
    let result = '';

    const writer = new Writable({
      write(chunk, encoding, callback) {
        result += chunk.toString();
        callback();
      },
    });

    transform.pipe(writer);
    transform.write({ id: 1, name: "O'Conner", active: true });
    transform.end();

    await new Promise((resolve) => writer.on('finish', resolve));

    expect(result).toBe("INSERT INTO users (id, name, active) VALUES (1, 'O''Conner', true);\n");
  });
});

describe('DatabaseAdvanceService - Connection integrity & Pipeline mocks', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      query: vi.fn().mockImplementation((queryObj) => {
        if (typeof queryObj === 'string') {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        // Return a readable stream that simulates row emission
        const stream = new Readable({
          objectMode: true,
          read() {
            this.push({ id: 1, name: 'Alice' });
            this.push(null);
          },
        });
        return stream;
      }),
      release: vi.fn(),
    };
    mockConnect.mockResolvedValue(mockClient);
  });

  test('pipeline failure still releases the database client exactly once', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    // Inject a write stream that throws an error immediately on write
    const failingWriter = new Writable({
      write(chunk, encoding, callback) {
        callback(new Error('Write target crashed'));
      },
    });

    await expect(svc.exportTableDataStream('users', 'json', failingWriter)).rejects.toThrow(
      'Write target crashed'
    );

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  test('successful pipeline execution releases the database client exactly once', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    const writer = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });

    await svc.exportTableDataStream('users', 'json', writer);

    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
