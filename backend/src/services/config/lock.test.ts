import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { withConfigApplyLock } from './lock.js';

/**
 * Builds a fake pg Pool that simulates pg_advisory_lock semantics in
 * memory. Same advisory key on two clients serializes; different keys
 * never block. This exercises the helper's lock-acquire/release flow
 * end-to-end without needing a live Postgres.
 */
function makeFakePool(): { pool: Pool; lockSql: string[]; unlockSql: string[] } {
  const heldKeys = new Map<string, Promise<void>>(); // key → currently held promise
  const lockSql: string[] = [];
  const unlockSql: string[] = [];

  function makeClient() {
    let myKey: string | null = null;
    let myResolve: (() => void) | null = null;

    return {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        const ns = String(params[0]);
        const sub = String(params[1]);
        const key = `${ns}|${sub}`;

        if (sql.includes('pg_advisory_lock')) {
          lockSql.push(`${ns},${sub}`);
          // Wait for any existing holder of this key.
          while (heldKeys.has(key)) {
            await heldKeys.get(key);
          }
          // Take the key.
          myKey = key;
          const release = new Promise<void>((r) => {
            myResolve = r;
          });
          heldKeys.set(key, release);
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_unlock')) {
          unlockSql.push(`${ns},${sub}`);
          if (myKey) {
            heldKeys.delete(myKey);
            myResolve?.();
            myKey = null;
            myResolve = null;
          }
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      release: vi.fn(() => {
        if (myKey) {
          heldKeys.delete(myKey);
          myResolve?.();
          myKey = null;
        }
      }),
    };
  }

  const pool = {
    connect: vi.fn(async () => makeClient()),
  } as unknown as Pool;

  return { pool, lockSql, unlockSql };
}

describe('withConfigApplyLock', () => {
  it('serializes concurrent acquisitions for the same project', async () => {
    const { pool } = makeFakePool();
    const order: string[] = [];

    await Promise.all([
      withConfigApplyLock(pool, 'proj-1', async () => {
        order.push('A-start');
        await new Promise((r) => setTimeout(r, 50));
        order.push('A-end');
      }),
      withConfigApplyLock(pool, 'proj-1', async () => {
        order.push('B-start');
        order.push('B-end');
      }),
    ]);

    // B must not start until A ends.
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('does not block different projects', async () => {
    const { pool } = makeFakePool();
    let bStarted = false;

    await Promise.all([
      withConfigApplyLock(pool, 'proj-1', async () => {
        await new Promise((r) => setTimeout(r, 50));
        // B should have started already because it's a different project.
        expect(bStarted).toBe(true);
      }),
      withConfigApplyLock(pool, 'proj-2', async () => {
        bStarted = true;
      }),
    ]);
  });

  it('releases the lock on error', async () => {
    const { pool, lockSql, unlockSql } = makeFakePool();

    await expect(
      withConfigApplyLock(pool, 'proj-err', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Acquire again — should succeed if the prior lock was released.
    await withConfigApplyLock(pool, 'proj-err', async () => {
      // ok
    });

    expect(lockSql).toHaveLength(2);
    expect(unlockSql).toHaveLength(2);
  });

  it('hashes different project refs to (likely) different keys', async () => {
    const { pool, lockSql } = makeFakePool();
    await withConfigApplyLock(pool, 'proj-a', async () => {});
    await withConfigApplyLock(pool, 'proj-b', async () => {});
    // Both lock calls share the same namespace ($1) but a different $2 sub-key.
    expect(lockSql).toHaveLength(2);
    const [first, second] = lockSql;
    const subA = first.split(',')[1];
    const subB = second.split(',')[1];
    expect(subA).not.toEqual(subB);
  });
});
