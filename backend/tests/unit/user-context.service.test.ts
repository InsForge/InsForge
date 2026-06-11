import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  withAdminContext,
  withUserContext,
} from '../../src/services/database/user-context.service';
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

  it('authenticated path sets role + jwt claims inside a transaction and commits', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    const result = await withUserContext(
      pool,
      {
        id: 'ZVP5j6raUC9cuBIWzDGjdNdelMFjWNc5',
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
      'SELECT set_config($1, $2, true)',
      'SELECT 1',
      'COMMIT',
      'RESET ROLE',
    ]);

    expect(calls[2].params?.[0]).toBe('request.jwt.claims');
    expect(JSON.parse(calls[2].params![1] as string)).toEqual({
      role: 'authenticated',
      sub: 'ZVP5j6raUC9cuBIWzDGjdNdelMFjWNc5',
      email: 'alice@example.com',
    });
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('sets anon role in the canonical claims object when id is undefined', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await withUserContext(pool, { role: 'anon' }, async () => {});

    expect(calls[2].params?.[0]).toBe('request.jwt.claims');
    expect(JSON.parse(calls[2].params![1] as string)).toEqual({ role: 'anon' });
    const setLocalRole = calls.find((c) => c.sql.startsWith('SET LOCAL ROLE'));
    expect(setLocalRole?.sql).toBe('SET LOCAL ROLE anon');
  });

  it('can run as project_admin when the caller wants database policies to decide', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await withUserContext(
      pool,
      {
        id: 'local:admin',
        role: 'project_admin',
      },
      async () => {}
    );

    expect(calls.map((c) => c.sql)).toContain('SET LOCAL ROLE project_admin');
    expect(calls[2].params?.[0]).toBe('request.jwt.claims');
    expect(JSON.parse(calls[2].params![1] as string)).toEqual({
      role: 'project_admin',
    });
  });

  it('sets extra runtime GUCs inside the same transaction', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await withUserContext(
      pool,
      { id: 'u1', email: 'u1@example.com', role: 'authenticated' },
      async (db) => {
        await db.query('SELECT 1');
      },
      {
        'realtime.channel_name': 'chat:lobby',
        ignored: undefined,
      }
    );

    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT 1',
      'COMMIT',
      'RESET ROLE',
    ]);
    expect(calls[2].params?.[0]).toBe('request.jwt.claims');
    expect(calls[3].params).toEqual(['realtime.channel_name', 'chat:lobby']);
  });

  it('rejects attempts to override centralized JWT settings', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await expect(
      withUserContext(
        pool,
        { id: 'u1', email: 'u1@example.com', role: 'authenticated' },
        async () => {},
        { 'request.jwt.foo': 'evil' }
      )
    ).rejects.toThrow(/must not override request\.jwt\.\*/);

    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT set_config($1, $2, true)',
      'ROLLBACK',
      'RESET ROLE',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rejects mixed-case attempts to override centralized JWT settings', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await expect(
      withUserContext(
        pool,
        { id: 'u1', email: 'u1@example.com', role: 'authenticated' },
        async () => {},
        { 'Request.Jwt.Claims': '{"sub":"evil"}' }
      )
    ).rejects.toThrow(/must not override request\.jwt\.\*/);

    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT set_config($1, $2, true)',
      'ROLLBACK',
      'RESET ROLE',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and resets role if fn throws', async () => {
    const { client, calls } = makeMockClient();
    const pool = makeMockPool(client);

    await expect(
      withUserContext(
        pool,
        { id: 'u1', email: 'u1@example.com', role: 'authenticated' },
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');

    // Pin the exact sequence — flipping order or skipping RESET ROLE
    // silently leaks role state across the pool.
    expect(calls.map((c) => c.sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE authenticated',
      'SELECT set_config($1, $2, true)',
      'ROLLBACK',
      'RESET ROLE',
    ]);
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

    await withUserContext(
      pool,
      { id: 'u1', email: 'u1@example.com', role: 'authenticated' },
      async () => {}
    );

    expect(calls.map((c) => c.sql)).toContain('RESET ROLE');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('withAdminContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses session-level project_admin context by default and resets it', async () => {
    const { client, calls } = makeMockClient();

    const result = await withAdminContext(client, async () => {
      await client.query('SELECT 1');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls.map((c) => c.sql)).toEqual([
      'SET ROLE project_admin',
      'SELECT set_config($1, $2, $3)',
      'SELECT 1',
      'RESET ROLE',
      'SELECT set_config($1, $2, $3)',
    ]);
    expect(calls[1].params).toEqual([
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      false,
    ]);
    expect(calls[4].params).toEqual(['request.jwt.claims', '{}', false]);
  });

  it('uses transaction-local project_admin context when requested', async () => {
    const { client, calls } = makeMockClient();

    await withAdminContext(
      client,
      async () => {
        await client.query('CREATE TABLE public.todos (id uuid)');
      },
      true
    );

    expect(calls.map((c) => c.sql)).toEqual([
      'SET LOCAL ROLE project_admin',
      'SELECT set_config($1, $2, $3)',
      'CREATE TABLE public.todos (id uuid)',
      'RESET ROLE',
      'SELECT set_config($1, $2, $3)',
    ]);
    expect(calls[1].params).toEqual([
      'request.jwt.claims',
      JSON.stringify({ role: 'project_admin' }),
      true,
    ]);
    expect(calls[4].params).toEqual(['request.jwt.claims', '{}', true]);
  });

  it('does not swallow admin context cleanup failures', async () => {
    const { client, calls } = makeMockClient();
    const resetError = new Error('reset failed');
    const cleanupErrors: Error[] = [];

    (client.query as ReturnType<typeof vi.fn>).mockImplementation(
      async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql === 'RESET ROLE') {
          throw resetError;
        }
        return { rows: [], rowCount: 0 };
      }
    );

    await expect(
      withAdminContext(
        client,
        async () => 'ok',
        false,
        (error) => cleanupErrors.push(error)
      )
    ).rejects.toBe(resetError);
    expect(cleanupErrors).toEqual([resetError]);
  });

  it('preserves the original SQL error when admin context cleanup also fails', async () => {
    const { client, calls } = makeMockClient();
    const sqlError = new Error('sql failed');
    const resetError = new Error('reset failed');
    const cleanupErrors: Error[] = [];

    (client.query as ReturnType<typeof vi.fn>).mockImplementation(
      async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        if (sql === 'RESET ROLE') {
          throw resetError;
        }
        return { rows: [], rowCount: 0 };
      }
    );

    await expect(
      withAdminContext(
        client,
        async () => {
          throw sqlError;
        },
        false,
        (error) => cleanupErrors.push(error)
      )
    ).rejects.toBe(sqlError);
    expect(sqlError.cause).toBe(resetError);
    expect(cleanupErrors).toEqual([resetError]);
  });

  it('lets the surrounding transaction rollback clear local context after SQL failures', async () => {
    const { client, calls } = makeMockClient();

    await expect(
      withAdminContext(
        client,
        async () => {
          await client.query('SELECT broken');
          throw new Error('sql failed');
        },
        true
      )
    ).rejects.toThrow('sql failed');

    expect(calls.map((c) => c.sql)).toEqual([
      'SET LOCAL ROLE project_admin',
      'SELECT set_config($1, $2, $3)',
      'SELECT broken',
    ]);
  });
});
