import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/utils/logger.js', () => ({
  default: loggerMocks,
}));

vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => mockPool }),
  },
}));

let mockPool: Pool;
let calls: Array<{ sql: string; params?: unknown[] }>;
// Per-call queue: each entry is the result for the next .query() call; an
// entry with `throwMessage` makes that call reject (e.g. pool exhaustion).
let queryResults: Array<{ rows?: unknown[]; rowCount?: number; throwMessage?: string }>;

function makeMockPool(): Pool {
  calls = [];
  queryResults = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const result = queryResults.shift() ?? { rows: [], rowCount: 0 };
    if (result.throwMessage) {
      throw new Error(result.throwMessage);
    }
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return { query, connect: vi.fn(async () => client) } as unknown as Pool;
}

const visibilityQueries = () =>
  calls.filter((c) => c.sql.includes('SELECT public FROM storage.buckets'));

describe('StorageService.isBucketPublic — cached visibility lookup', () => {
  beforeEach(() => {
    mockPool = makeMockPool();
    loggerMocks.warn.mockClear();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries once and serves the cached value inside the TTL', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [{ rows: [{ public: true }], rowCount: 1 }];

    expect(await svc.isBucketPublic('avatars')).toBe(true);
    expect(await svc.isBucketPublic('avatars')).toBe(true);
    expect(await svc.isBucketPublic('avatars')).toBe(true);
    expect(visibilityQueries()).toHaveLength(1);
  });

  it('re-queries after the TTL expires', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { rows: [{ public: false }], rowCount: 1 },
    ];

    expect(await svc.isBucketPublic('avatars')).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(await svc.isBucketPublic('avatars')).toBe(false);
    expect(visibilityQueries()).toHaveLength(2);
  });

  it('serves the last known value when the DB lookup fails after the TTL', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { throwMessage: 'sorry, too many clients already' },
    ];

    expect(await svc.isBucketPublic('avatars')).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(await svc.isBucketPublic('avatars')).toBe(true);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      'Bucket visibility lookup failed; serving last known value',
      expect.objectContaining({ bucket: 'avatars', error: 'sorry, too many clients already' })
    );
  });

  it('does not serve a stale value older than the stale ceiling', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { throwMessage: 'sorry, too many clients already' },
    ];

    expect(await svc.isBucketPublic('avatars')).toBe(true);
    vi.advanceTimersByTime(6 * 60_000);
    await expect(svc.isBucketPublic('avatars')).rejects.toThrow('too many clients');
  });

  it('propagates the DB error when there is no cached value', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [{ throwMessage: 'sorry, too many clients already' }];

    await expect(svc.isBucketPublic('avatars')).rejects.toThrow('too many clients');
  });

  it('invalidates the cache when visibility is updated', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 }, // initial lookup
      { rows: [{ exists: true }], rowCount: 1 }, // bucketExists inside updateBucketVisibility
      { rows: [], rowCount: 1 }, // UPDATE
      { rows: [{ public: false }], rowCount: 1 }, // re-lookup after invalidation
    ];

    expect(await svc.isBucketPublic('avatars')).toBe(true);
    await svc.updateBucketVisibility('avatars', false);
    expect(await svc.isBucketPublic('avatars')).toBe(false);
    expect(visibilityQueries()).toHaveLength(2);
  });
});
