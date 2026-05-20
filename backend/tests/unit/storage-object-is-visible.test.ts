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
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    const result = queryResults.shift() ?? { rows: [], rowCount: 0 };
    return result;
  });
  const client = {
    query,
    release: vi.fn(),
  } as unknown as PoolClient;
  return {
    query,
    connect: vi.fn(async () => client),
  } as unknown as Pool;
}

describe('StorageService.objectIsVisible — RLS-gated visibility check', () => {
  beforeEach(async () => {
    mockPool = makeMockPool();
    vi.resetModules();
  });

  it('runs through withUserContext for user callers and returns true when SELECT finds a row', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    // The SELECT 1 returns a row, so objectIsVisible should return true.
    queryResults = [
      { rows: [{ public: false }], rowCount: 1 }, // public bucket check
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [{ '?column?': 1 }], rowCount: 1 }, // row visible
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.objectIsVisible(
      { id: 'alice-sub', email: 'alice@example.com', role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(true);

    // Verify the SELECT happened *inside* withUserContext (BEGIN before, COMMIT after).
    const sequence = calls.map((c) => c.sql);
    expect(sequence[0]).toBe('SELECT public FROM storage.buckets WHERE name = $1');
    expect(sequence[1]).toBe('BEGIN');
    expect(sequence[2]).toBe('SET LOCAL ROLE authenticated');
    expect(calls[3].params?.[0]).toBe('request.jwt.claims');
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
      { rows: [{ public: false }], rowCount: 1 }, // public bucket check
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [], rowCount: 0 }, // RLS-filtered to empty
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.objectIsVisible(
      { id: 'bob-sub', email: 'bob@example.com', role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(false);
  });

  it('runs SELECT directly on the pool for API-key callers', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [{ rows: [{ '?column?': 1 }], rowCount: 1 }];

    const visible = await svc.objectIsVisible(undefined, 'photos', 'alice/cat.jpg', true);

    expect(visible).toBe(true);
    // API-key path skips BEGIN/SET ROLE/COMMIT — only the visibility SELECT runs.
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('runs project_admin JWT callers through withUserContext instead of API-key access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [
      { rows: [{ public: false }], rowCount: 1 }, // public bucket check
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE project_admin
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [{ '?column?': 1 }], rowCount: 1 }, // row visible
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.objectIsVisible(
      { id: 'admin-sub', email: 'admin@example.com', role: 'project_admin' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(true);
    expect(calls.map((c) => c.sql)).toContain('SET LOCAL ROLE project_admin');
    expect(calls[3].params).toEqual([
      'request.jwt.claims',
      JSON.stringify({
        role: 'project_admin',
        sub: 'admin-sub',
        email: 'admin@example.com',
      }),
    ]);
  });

  it('returns false for private bucket objects without a user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [{ rows: [{ public: false }], rowCount: 1 }];

    await expect(svc.objectIsVisible(undefined, 'photos', 'alice/cat.jpg')).resolves.toBe(false);
    expect(calls).toEqual([
      {
        sql: 'SELECT public FROM storage.buckets WHERE name = $1',
        params: ['photos'],
      },
    ]);
  });

  it('returns a generic 403 for write-like operations without user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const { AppError } = await import('@/api/middlewares/error.js');
    const svc = StorageService.getInstance();

    await expect(
      svc.listObjects(undefined, 'photos', undefined, 100, 0, undefined)
    ).rejects.toMatchObject({
      message: 'Forbidden',
      statusCode: 403,
      code: 'STORAGE_PERMISSION_DENIED',
    });
    await expect(
      svc.listObjects(undefined, 'photos', undefined, 100, 0, undefined)
    ).rejects.toBeInstanceOf(AppError);
  });

  it('returns true for public bucket objects without requiring user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { rows: [{ '?column?': 1 }], rowCount: 1 },
    ];

    const visible = await svc.objectIsVisible(undefined, 'photos', 'alice/cat.jpg');

    expect(visible).toBe(true);
    expect(calls).toEqual([
      {
        sql: 'SELECT public FROM storage.buckets WHERE name = $1',
        params: ['photos'],
      },
      {
        sql: 'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
        params: ['photos', 'alice/cat.jpg'],
      },
    ]);
  });

  it('returns false for missing objects in public buckets', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { rows: [], rowCount: 0 },
    ];

    const visible = await svc.objectIsVisible(undefined, 'photos', 'missing.jpg');

    expect(visible).toBe(false);
    expect(calls).toEqual([
      {
        sql: 'SELECT public FROM storage.buckets WHERE name = $1',
        params: ['photos'],
      },
      {
        sql: 'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
        params: ['photos', 'missing.jpg'],
      },
    ]);
  });

  it('getObject reads public bucket objects without user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      getObject: vi.fn(async () => Buffer.from('hello')),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    const uploadedAt = new Date('2026-01-01T00:00:00.000Z');
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      {
        rows: [
          {
            bucket: 'photos',
            key: 'alice/cat.jpg',
            size: 42,
            mime_type: 'image/jpeg',
            uploaded_at: uploadedAt,
            etag: 'etag-public',
          },
        ],
        rowCount: 1,
      },
    ];

    const result = await svc.getObject(undefined, 'photos', 'alice/cat.jpg');

    expect(result?.file.toString()).toBe('hello');
    expect(result?.metadata).toMatchObject({
      bucket: 'photos',
      key: 'alice/cat.jpg',
      size: 42,
      mimeType: 'image/jpeg',
      uploadedAt,
    });
    expect(provider.getObject).toHaveBeenCalledWith('photos', 'alice/cat.jpg');
  });

  it('getObject reads public bucket objects with a user context without RLS', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      getObject: vi.fn(async () => Buffer.from('hello')),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    const uploadedAt = new Date('2026-01-01T00:00:00.000Z');
    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      {
        rows: [
          {
            bucket: 'photos',
            key: 'alice/cat.jpg',
            size: 42,
            mime_type: 'image/jpeg',
            uploaded_at: uploadedAt,
            etag: 'etag-public',
          },
        ],
        rowCount: 1,
      },
    ];

    const result = await svc.getObject(
      { id: 'bob-sub', email: 'bob@example.com', role: 'authenticated' },
      'photos',
      'alice/cat.jpg'
    );

    expect(result?.file.toString()).toBe('hello');
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT public FROM storage.buckets WHERE name = $1',
      'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
    expect(provider.getObject).toHaveBeenCalledWith('photos', 'alice/cat.jpg');
  });

  it('rejects invalid bucket names before touching the database', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    await expect(
      svc.objectIsVisible(
        { id: 'alice', email: 'alice@example.com', role: 'authenticated' },
        'no spaces allowed',
        'k'
      )
    ).rejects.toThrow(/Invalid bucket name/);
    expect(calls).toHaveLength(0);
  });

  it('rejects directory-traversal keys before touching the database', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    await expect(
      svc.objectIsVisible(
        { id: 'alice', email: 'alice@example.com', role: 'authenticated' },
        'photos',
        '../../etc/passwd'
      )
    ).rejects.toThrow(/Invalid key/);
    expect(calls).toHaveLength(0);
  });
});
