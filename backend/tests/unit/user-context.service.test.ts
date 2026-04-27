import { describe, expect, it, vi, beforeEach } from 'vitest';
import { withUserContext } from '../../src/services/db/user-context.service';
import type { Pool, PoolClient } from 'pg';

/**
 * Records every query call so the test can assert ordering and arguments.
 */
function makeMockClient() {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 } as unknown;
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return { client, calls };
}

function makeMockPool(client: PoolClient): Pool {
  return {
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

describe('withUserContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin path skips role/JWT setup and runs fn with the raw connection', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    const result = await withUserContext(
      pool,
      { isAdmin: true, role: 'authenticated' },
      async (db) => {
        await db.query('SELECT 1');
        return 42;
      }
    );

    expect(result).toBe(42);
    // Admin path does NOT call BEGIN/SET ROLE/set_config — only the inner fn's query.
    expect(calls.map((c) => c.sql)).toEqual(['SELECT 1']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('authenticated path sets role + jwt claims inside a transaction and commits', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    const result = await withUserContext(
      pool,
      {
        userId: 'ZVP5j6raUC9cuBIWzDGjdNdelMFjWNc5',
        role: 'authenticated',
        email: 'alice@example.com',
      },
      async (db) => {
        await db.query('SELECT 1');
        return 'ok';
      }
    );

    expect(result).toBe('ok');
    const sequence = calls.map((c) => c.sql);
    expect(sequence).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      "SELECT set_config('request.jwt.claim.sub', $1, true)",
      "SELECT set_config('request.jwt.claim.role', $1, true)",
      "SELECT set_config('request.jwt.claim.email', $1, true)",
      'SELECT 1',
      'COMMIT',
      'RESET ROLE',
    ]);

    expect(calls[2].params).toEqual(['ZVP5j6raUC9cuBIWzDGjdNdelMFjWNc5']);
    expect(calls[3].params).toEqual(['authenticated']);
    expect(calls[4].params).toEqual(['alice@example.com']);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('passes empty string as sub when userId is undefined (anon-like fallback)', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await withUserContext(pool, { role: 'anon' }, async () => {});

    const setSub = calls.find((c) => c.sql.includes("set_config('request.jwt.claim.sub'"));
    expect(setSub?.params).toEqual(['']);
    const setLocalRole = calls.find((c) => c.sql.startsWith('SET LOCAL ROLE'));
    expect(setLocalRole?.sql).toBe('SET LOCAL ROLE anon');
  });

  it('rolls back and resets role if fn throws', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await expect(
      withUserContext(pool, { userId: 'u1', role: 'authenticated' }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const sequence = calls.map((c) => c.sql);
    expect(sequence).toContain('BEGIN');
    expect(sequence).toContain('ROLLBACK');
    expect(sequence).toContain('RESET ROLE');
    // No COMMIT happened
    expect(sequence).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('always releases the client even if RESET ROLE fails', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    // Make RESET ROLE fail
    (client.query as ReturnType<typeof vi.fn>).mockImplementation(
      async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql === 'RESET ROLE') {
          throw new Error('reset failed');
        }
        return { rows: [], rowCount: 0 };
      }
    );

    await withUserContext(pool, { userId: 'u1', role: 'authenticated' }, async () => {});

    expect(client.release).toHaveBeenCalledOnce();
  });
});
