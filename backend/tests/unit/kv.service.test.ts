import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the DB pool the service pulls from DatabaseManager.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => ({ query: mockQuery }) }),
  },
}));

import { KvService } from '@/services/kv/kv.service';
import { AppError } from '@/utils/errors';

const ADMIN = { mode: 'admin' as const };

describe('KvService (admin / project-global path)', () => {
  const service = KvService.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get returns the stored JSON value, or null when missing/expired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { a: 1 } }], rowCount: 1 });
    await expect(service.get(ADMIN, 'default', 'k')).resolves.toEqual({ a: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.get(ADMIN, 'default', 'missing')).resolves.toBeNull();
  });

  it('set defaults to a 30-day TTL and a NULL (project-global) owner', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: 'v',
          visibility: 'private',
          expires_at: new Date('2026-08-01T00:00:00Z'),
          created_at: new Date('2026-06-28T00:00:00Z'),
          updated_at: new Date('2026-06-28T00:00:00Z'),
          inserted: true,
        },
      ],
      rowCount: 1,
    });

    const result = await service.set(ADMIN, 'default', 'k', { value: 'v' });
    expect(result.created).toBe(true);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    // owner_id (param 4) is null; ttl seconds (param 6) is the 30-day default.
    expect(params[3]).toBeNull();
    expect(params[5]).toBe(60 * 60 * 24 * 30);
  });

  it('set with ttl=null persists a non-expiring entry', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: 'v',
          visibility: 'private',
          expires_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      rowCount: 1,
    });
    await service.set(ADMIN, 'default', 'k', { value: 'v', ttl: null });
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[5]).toBeNull();
  });

  it('set ifNotExists reports created=false when the row already exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await service.set(ADMIN, 'default', 'k', { value: 'v', ifNotExists: true });
    expect(result).toEqual({ created: false, entry: null });
  });

  it('set reports created=false when ON CONFLICT updated an existing key (xmax)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          value: 'v',
          visibility: 'private',
          expires_at: null,
          created_at: new Date(),
          updated_at: new Date(),
          inserted: false, // xmax != 0 -> this was an update, not an insert
        },
      ],
      rowCount: 1,
    });
    const result = await service.set(ADMIN, 'default', 'k', { value: 'v' });
    expect(result.created).toBe(false);
    expect(result.entry).not.toBeNull();
    expect(mockQuery.mock.calls[0][0]).toContain('(xmax = 0) AS inserted');
  });

  it('del guards against logically-expired rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.del(ADMIN, 'default', 'k')).resolves.toBe(false);
    expect(mockQuery.mock.calls[0][0]).toContain('expires_at IS NULL OR expires_at > NOW()');
  });

  it('mset writes all pairs in a single atomic statement', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 });
    await expect(service.mset(ADMIN, 'default', { a: 1, b: 2 })).resolves.toBe(2);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
    expect((sql.match(/::jsonb/g) || []).length).toBe(2); // one value tuple per key
  });

  it('rejects values over the size cap before touching the database', async () => {
    const huge = { blob: 'x'.repeat(300 * 1024) };
    await expect(service.set(ADMIN, 'default', 'k', { value: huge })).rejects.toMatchObject({
      code: 'KV_VALUE_TOO_LARGE',
      statusCode: 413,
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('incrBy returns the new numeric value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: 5 }], rowCount: 1 });
    await expect(service.incrBy(ADMIN, 'default', 'counter', 5)).resolves.toBe(5);
  });

  it('incrBy maps a non-numeric existing value (pg 22P02) to KV_NOT_A_NUMBER', async () => {
    mockQuery.mockRejectedValueOnce({ code: '22P02' });
    await expect(service.incrBy(ADMIN, 'default', 'k', 1)).rejects.toMatchObject({
      code: 'KV_NOT_A_NUMBER',
      statusCode: 400,
    });
  });

  it('cas throws 409 on value mismatch and 404 when the key is absent', async () => {
    // mismatch: UPDATE affects nothing, existence check finds the row
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    await expect(service.cas(ADMIN, 'default', 'k', 'old', 'new')).rejects.toMatchObject({
      code: 'KV_CAS_MISMATCH',
      statusCode: 409,
    });

    // absent: UPDATE affects nothing, existence check finds nothing
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.cas(ADMIN, 'default', 'k', 'old', 'new')).rejects.toMatchObject({
      code: 'KV_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('ttl throws KV_NOT_FOUND when the key is absent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.ttl(ADMIN, 'default', 'k')).rejects.toBeInstanceOf(AppError);
  });

  it('mget returns a key->value map, omitting missing keys', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: 'a', value: 1 },
        { key: 'b', value: { nested: true } },
      ],
      rowCount: 2,
    });
    await expect(service.mget(ADMIN, 'default', ['a', 'b', 'c'])).resolves.toEqual({
      a: 1,
      b: { nested: true },
    });
  });
});
