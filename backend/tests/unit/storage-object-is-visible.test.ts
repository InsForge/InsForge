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

describe('StorageService.getObjectMetadataVisible — RLS-gated visibility check', () => {
  beforeEach(async () => {
    mockPool = makeMockPool();
    vi.resetModules();
  });

  it('runs through withUserContext for user callers and returns true when SELECT finds a row', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    // The SELECT 1 returns a row, so getObjectMetadataVisible should return true.
    queryResults = [
      { rows: [{ public: false }], rowCount: 1 }, // public bucket check
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [{ '?column?': 1 }], rowCount: 1 }, // row visible
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const visible = await svc.getObjectMetadataVisible(
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

    const visible = await svc.getObjectMetadataVisible(
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

    const visible = await svc.getObjectMetadataVisible(undefined, 'photos', 'alice/cat.jpg', true);

    expect(visible).toBe(true);
    // API-key path skips BEGIN/SET ROLE/COMMIT — only the visibility SELECT runs.
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('runs project_admin JWT callers through root access like API-key callers', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [{ rows: [{ '?column?': 1 }], rowCount: 1 }];

    const visible = await svc.getObjectMetadataVisible(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      'alice/cat.jpg'
    );

    expect(visible).toBe(true);
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT 1 FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('reads objects for project_admin JWT callers through root access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const uploadedAt = new Date('2026-01-01T00:00:00.000Z');
    const provider = {
      getObject: vi.fn(async () => Buffer.from('hello')),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    queryResults = [
      {
        rows: [
          {
            bucket: 'photos',
            key: 'alice/cat.jpg',
            size: 42,
            mime_type: 'image/jpeg',
            uploaded_at: uploadedAt,
            etag: 'etag-admin',
          },
        ],
        rowCount: 1,
      },
    ];

    const result = await svc.getObject(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      'alice/cat.jpg'
    );

    expect(result?.file.toString()).toBe('hello');
    expect(result?.metadata).toMatchObject({
      bucket: 'photos',
      key: 'alice/cat.jpg',
      size: 42,
      mimeType: 'image/jpeg',
      uploadedAt,
    });
    expect(provider.getObject).toHaveBeenCalledWith('photos', 'alice/cat.jpg');
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('lists objects for project_admin JWT callers through root access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const uploadedAt = new Date('2026-01-01T00:00:00.000Z');

    queryResults = [
      {
        rows: [
          {
            bucket: 'photos',
            key: 'alice/cat.jpg',
            size: 42,
            mime_type: 'image/jpeg',
            uploaded_at: uploadedAt,
            etag: 'etag-admin',
          },
        ],
        rowCount: 1,
      },
      { rows: [{ count: '1' }], rowCount: 1 },
    ];

    const result = await svc.listObjects(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      undefined,
      10,
      0,
      undefined
    );

    expect(result.total).toBe(1);
    expect(result.objects[0]).toMatchObject({
      bucket: 'photos',
      key: 'alice/cat.jpg',
      size: 42,
      mimeType: 'image/jpeg',
      uploadedAt,
    });
    expect(calls.map((c) => c.sql)).toEqual([
      'SELECT * FROM storage.objects WHERE bucket = $1 ORDER BY key LIMIT $2 OFFSET $3',
      'SELECT COUNT(*) as count FROM storage.objects WHERE bucket = $1',
    ]);
    expect(calls.map((c) => c.params)).toEqual([['photos', 10, 0], ['photos']]);
  });

  it('returns false for private bucket objects without a user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [{ rows: [{ public: false }], rowCount: 1 }];

    await expect(svc.getObjectMetadataVisible(undefined, 'photos', 'alice/cat.jpg')).resolves.toBe(false);
    expect(calls).toEqual([
      {
        sql: 'SELECT public FROM storage.buckets WHERE name = $1',
        params: ['photos'],
      },
    ]);
  });

  it('returns a generic 403 for write-like operations without user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const { AppError } = await import('@/utils/errors.js');
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

  it('checks upload-strategy bucket existence outside the user-context transaction', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      getUploadStrategy: vi.fn(async () => ({
        method: 'direct' as const,
        uploadUrl: '/upload',
        key: 'note.txt',
        confirmRequired: false,
      })),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    queryResults = [
      { rows: [{ name: 'photos' }], rowCount: 1 }, // root bucket existence check
      { rows: [], rowCount: 0 }, // root object dedup query
      { rows: [{ maxFileSizeMb: 50 }], rowCount: 1 }, // storage config
      { rows: [], rowCount: 0 }, // BEGIN
      { rows: [], rowCount: 0 }, // SET LOCAL ROLE authenticated
      { rows: [], rowCount: 0 }, // set_config(claims)
      { rows: [], rowCount: 0 }, // SAVEPOINT
      { rows: [], rowCount: 1 }, // RLS INSERT probe
      { rows: [], rowCount: 0 }, // ROLLBACK TO SAVEPOINT
      { rows: [], rowCount: 0 }, // RELEASE SAVEPOINT
      { rows: [], rowCount: 0 }, // COMMIT
      { rows: [], rowCount: 0 }, // RESET ROLE
    ];

    const strategy = await svc.getUploadStrategy(
      { id: 'alice-sub', email: 'alice@example.com', role: 'authenticated' },
      'photos',
      { filename: 'note.txt', contentType: 'text/plain', size: 8 }
    );

    expect(strategy).toMatchObject({ method: 'direct', key: 'note.txt' });
    expect(calls[0]).toEqual({
      sql: 'SELECT 1 FROM storage.buckets WHERE name = $1 LIMIT 1',
      params: ['photos'],
    });
    expect(calls[1].sql).toContain('SELECT key FROM storage.objects');
    expect(calls[3].sql).toBe('BEGIN');
    expect(calls[4].sql).toBe('SET LOCAL ROLE authenticated');
    expect(calls.map((c) => c.sql).slice(1)).not.toContain(
      'SELECT 1 FROM storage.buckets WHERE name = $1 LIMIT 1'
    );
    expect(calls.map((c) => c.sql)).toContain('SAVEPOINT upload_strategy_rls_probe');
    expect(calls.map((c) => c.sql)).toContain('ROLLBACK TO SAVEPOINT upload_strategy_rls_probe');
    expect(calls.some((c) => c.sql.includes('INSERT INTO storage.objects'))).toBe(true);
  });

  it('skips the upload-strategy RLS insert probe for project_admin JWT callers', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      getUploadStrategy: vi.fn(async () => ({
        method: 'direct' as const,
        uploadUrl: '/upload',
        key: 'note.txt',
        confirmRequired: false,
      })),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    queryResults = [
      { rows: [{ name: 'photos' }], rowCount: 1 }, // root bucket existence check
      { rows: [], rowCount: 0 }, // root object dedup query
      { rows: [{ maxFileSizeMb: 50 }], rowCount: 1 }, // storage config
    ];

    const strategy = await svc.getUploadStrategy(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      { filename: 'note.txt', contentType: 'text/plain', size: 8 }
    );

    expect(strategy).toMatchObject({ method: 'direct', key: 'note.txt' });
    expect(calls.map((c) => c.sql)).not.toContain('BEGIN');
    expect(calls.map((c) => c.sql)).not.toContain('SET LOCAL ROLE project_admin');
    expect(calls.some((c) => c.sql.includes('INSERT INTO storage.objects'))).toBe(false);
  });

  it('uploads objects for project_admin JWT callers through root access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      putObject: vi.fn(async () => ({ etag: 'etag-admin-upload' })),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    // uploaded_at is supplied app-side, so the INSERT no longer uses RETURNING.
    queryResults = [
      { rows: [], rowCount: 0 }, // root object dedup query
      { rows: [], rowCount: 1 }, // root insert (no RETURNING)
      { rows: [], rowCount: 1 }, // root etag update
    ];

    const result = await svc.putObject(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      'note.txt',
      { size: 8, mimetype: 'text/plain' } as Express.Multer.File
    );

    expect(result).toMatchObject({
      bucket: 'photos',
      key: 'note.txt',
      size: 8,
      mimeType: 'text/plain',
    });
    // uploaded_at is an ISO string supplied app-side; assert it round-trips.
    expect(new Date(result.uploadedAt).toISOString()).toBe(result.uploadedAt);
    expect(provider.putObject).toHaveBeenCalledOnce();
    expect(calls.map((c) => c.sql)).not.toContain('BEGIN');
    expect(calls.map((c) => c.sql)).not.toContain('SET LOCAL ROLE project_admin');
    expect(calls.some((c) => c.sql.includes('INSERT INTO storage.objects'))).toBe(true);
    // The insert must not use RETURNING — that re-couples writes to SELECT RLS.
    expect(calls.some((c) => /RETURNING/i.test(c.sql))).toBe(false);
  });

  it('confirms presigned uploads for project_admin JWT callers through root access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      verifyObjectExists: vi.fn(async () => ({
        exists: true,
        size: 8,
        etag: 'etag-confirmed',
      })),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    // uploaded_at is supplied app-side, so the INSERT no longer uses RETURNING.
    queryResults = [
      { rows: [{ maxFileSizeMb: 50 }], rowCount: 1 }, // storage config
      { rows: [], rowCount: 0 }, // already-confirmed check
      { rows: [], rowCount: 1 }, // root insert (no RETURNING)
    ];

    const result = await svc.confirmUpload(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      'note.txt',
      { size: 8, contentType: 'text/plain' }
    );

    expect(result).toMatchObject({
      bucket: 'photos',
      key: 'note.txt',
      size: 8,
      mimeType: 'text/plain',
    });
    // uploaded_at is an ISO string supplied app-side; assert it round-trips.
    expect(new Date(result.uploadedAt).toISOString()).toBe(result.uploadedAt);
    expect(calls.map((c) => c.sql)).not.toContain('BEGIN');
    expect(calls.map((c) => c.sql)).not.toContain('SET LOCAL ROLE project_admin');
    expect(calls.some((c) => c.sql.includes('INSERT INTO storage.objects'))).toBe(true);
    // The insert must not use RETURNING — that re-couples writes to SELECT RLS.
    expect(calls.some((c) => /RETURNING/i.test(c.sql))).toBe(false);
  });

  it('deletes objects for project_admin JWT callers through root access', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();
    const provider = {
      deleteObject: vi.fn(async () => {}),
    };
    (svc as unknown as { provider: typeof provider }).provider = provider;

    queryResults = [{ rows: [], rowCount: 1 }];

    const deleted = await svc.deleteObject(
      { id: 'local:admin', role: 'project_admin' },
      'photos',
      'note.txt'
    );

    expect(deleted).toBe(true);
    expect(provider.deleteObject).toHaveBeenCalledWith('photos', 'note.txt');
    expect(calls.map((c) => c.sql)).toEqual([
      'DELETE FROM storage.objects WHERE bucket = $1 AND key = $2',
    ]);
  });

  it('returns true for public bucket objects without requiring user context', async () => {
    const { StorageService } = await import('@/services/storage/storage.service.js');
    const svc = StorageService.getInstance();

    queryResults = [
      { rows: [{ public: true }], rowCount: 1 },
      { rows: [{ '?column?': 1 }], rowCount: 1 },
    ];

    const visible = await svc.getObjectMetadataVisible(undefined, 'photos', 'alice/cat.jpg');

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

    const visible = await svc.getObjectMetadataVisible(undefined, 'photos', 'missing.jpg');

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
      svc.getObjectMetadataVisible(
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
      svc.getObjectMetadataVisible(
        { id: 'alice', email: 'alice@example.com', role: 'authenticated' },
        'photos',
        '../../etc/passwd'
      )
    ).rejects.toThrow(/Invalid key/);
    expect(calls).toHaveLength(0);
  });
});
