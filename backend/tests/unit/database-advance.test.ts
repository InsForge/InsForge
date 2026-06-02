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

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({ query: mockPoolQuery })),
    })),
  },
}));

describe('DatabaseAdvanceService - bulkInsert optional-column fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 2 });
  });

  test('includes columns from ALL records, not only the first', async () => {
    // records[0] has no `phone`; records[1] and records[2] do.
    // Before the fix, `phone` was silently omitted from the INSERT entirely.
    const svc = DatabaseAdvanceService.getInstance();

    await svc.bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob', phone: '555-0001' },
      { id: '3', name: 'Carol', phone: '555-0002' },
    ]);

    const sql: string = mockPoolQuery.mock.calls[0][0] as string;

    // phone must appear in the INSERT column list
    expect(sql).toContain('"phone"');
    // Bob and Carol phone values must be present in the values literal
    expect(sql).toContain('555-0001');
    expect(sql).toContain('555-0002');
  });

  test('records missing an optional field get NULL, not undefined', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await svc.bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob', phone: '555-0001' },
    ]);

    const sql: string = mockPoolQuery.mock.calls[0][0] as string;

    // Alice's row must not embed a raw JS `undefined` string
    expect(sql).not.toContain('undefined');
    // Her phone slot must be NULL
    expect(sql).toContain('NULL');
  });

  test('uniform records (all same columns) still work correctly', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await svc.bulkInsert('public', 'contacts', [
      { id: '1', name: 'Alice', phone: '555-0001' },
      { id: '2', name: 'Bob', phone: '555-0002' },
    ]);

    const sql: string = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('"id"');
    expect(sql).toContain('"name"');
    expect(sql).toContain('"phone"');
    expect(sql).toContain('555-0001');
    expect(sql).toContain('555-0002');
  });

  test('throws AppError when records array is empty', async () => {
    const svc = DatabaseAdvanceService.getInstance();
    await expect(svc.bulkInsert('public', 'contacts', [])).rejects.toBeInstanceOf(AppError);
  });

  test('upsert: optional column from later records is included in ON CONFLICT SET', async () => {
    const svc = DatabaseAdvanceService.getInstance();

    await svc.bulkInsert(
      'public',
      'contacts',
      [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob', phone: '555-0001' },
      ],
      'id'
    );

    const sql: string = mockPoolQuery.mock.calls[0][0] as string;
    expect(sql).toContain('"phone"');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE SET');
  });
});
