import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

// Mock the database manager so StorageService can be instantiated without
// touching a real pool. The service caches the pool internally; we hand it
// our mock via a controlled getInstance/getPool flow.
vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => mockPool }),
  },
}));

let mockPool: Pool;
let calls: Array<{ sql: string; params?: unknown[] }>;
// Per-call queue: each entry is the result for the next .query() call.
let queryResults: Array<{ rows: unknown[]; rowCount: number }>;

function makeMockPool(): Pool {
  calls = [];
  queryResults = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const result = queryResults.shift() ?? { rows: [], rowCount: 0 };
      return result;
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

describe('StorageService.objectIsVisible — RLS-gated visibility check', () => {
  beforeEach(async () => {
    mockPool = makeMockPool();
    vi.resetModules();
  });

  it('runs through withUserContext for non-admin callers and returns true when SELECT finds a row', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    // The SELECT 1 returns a row, so objectIsVisible should return true.
    queryResults = [
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [], rowCount: 0 }, // set_config(claim.sub)
      { rows: [], rowCount: 0 }, // set_config(claim.role)
      { rows: [{ '?column?': 1 }], rowCount: 1 }, // SELECT 1 — row visible
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.objectIsVisible(
      { userId: 'alice-sub', role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(true);

    // Verify the SELECT happened *inside* withUserContext (BEGIN before, COMMIT after).
    const sequence = calls.map((c) => c.sql);
    expect(sequence[0]).toBe('BEGIN');
    expect(sequence[1]).toBe('SET LOCAL ROLE authenticated');
    expect(sequence).toContain('SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2');
    expect(sequence[sequence.length - 2]).toBe('COMMIT');
    expect(sequence[sequence.length - 1]).toBe('RESET ROLE');

    // Verify the SELECT bound bucket and key as parameters.
    const selectCall = calls.find(
      (c) => c.sql === 'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2'
    );
    expect(selectCall?.params).toEqual(['photos', 'alice/cat.jpg']);
  });

  it('returns false when RLS denies the SELECT (zero rows)', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    // The SELECT returns zero rows — non-owner Bob asking for Alice's key.
    queryResults = [
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [], rowCount: 0 }, // set_config(claim.sub)
      { rows: [], rowCount: 0 }, // set_config(claim.role)
      { rows: [], rowCount: 0 }, // SELECT 1 — RLS-filtered to empty
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.objectIsVisible(
      { userId: 'bob-sub', role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(false);
  });

  it('admin bypasses withUserContext and runs SELECT directly on the pool', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [
      { rows: [{ '?column?': 1 }], rowCount: 1 }, // SELECT 1 — single query, no transaction
    ];

    const visible = await svc.objectIsVisible(
      { isAdmin: true, role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(true);
    // Admin path skips BEGIN/SET ROLE/COMMIT — only the inner SELECT runs.
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('rejects invalid bucket names before touching the database', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    await expect(
      svc.objectIsVisible({ userId: 'alice', role: 'authenticated' }, 'no spaces allowed', 'k')
    ).rejects.toThrow(/Invalid bucket name/);
    expect(calls).toHaveLength(0);
  });

  it('rejects directory-traversal keys before touching the database', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    await expect(
      svc.objectIsVisible({ userId: 'alice', role: 'authenticated' }, 'photos', '../../etc/passwd')
    ).rejects.toThrow(/Invalid key/);
    expect(calls).toHaveLength(0);
  });
});
