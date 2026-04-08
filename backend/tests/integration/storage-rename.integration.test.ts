/**
 * Integration tests for StorageService.renameObject
 *
 * These tests require a running PostgreSQL instance and exercise the full
 * rename flow: DB transaction + local filesystem provider + conflict detection.
 *
 * Run with:
 *   npm run test -- storage-rename.integration.test.ts
 *
 * Environment variables (defaults match docker-compose.yml):
 *   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { LocalStorageProvider } from '../../src/providers/storage/local.provider.js';
import { StorageService } from '../../src/services/storage/storage.service.js';
import { DatabaseManager } from '../../src/infra/database/database.manager.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const TEST_BUCKET = `int-test-rename-${Date.now()}`;
const STORAGE_DIR = path.resolve(import.meta.dirname, '../..', 'test-integration-storage');

async function getPool(): Promise<Pool> {
  return DatabaseManager.getInstance().getPool();
}

/** Write a real file into the provider's storage dir so renameObject finds it. */
async function seedFile(bucket: string, key: string, content = 'hello'): Promise<void> {
  const filePath = path.join(STORAGE_DIR, bucket, key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

/** Insert a row into storage.objects (FK to storage.buckets must exist). */
async function seedObjectRow(
  pool: Pool,
  bucket: string,
  key: string,
  size = 5
): Promise<void> {
  await pool.query(
    `INSERT INTO storage.objects (bucket, key, size, mime_type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [bucket, key, size, 'text/plain']
  );
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('StorageService.renameObject (integration)', () => {
  let pool: Pool;

  // ── global setup / teardown ─────────────────────────────────────────────

  beforeAll(async () => {
    await DatabaseManager.getInstance().initialize();
    pool = await getPool();

    // Provision test bucket row + storage directory once for the whole suite
    await pool.query(
      `INSERT INTO storage.buckets (name, public) VALUES ($1, false) ON CONFLICT DO NOTHING`,
      [TEST_BUCKET]
    );
    await fs.mkdir(path.join(STORAGE_DIR, TEST_BUCKET), { recursive: true });

    // Point the StorageService singleton at our temp local provider
    const provider = new LocalStorageProvider(STORAGE_DIR);
    await provider.initialize();
    const service = StorageService.getInstance() as unknown as {
      provider: LocalStorageProvider;
      pool: Pool;
    };
    service.provider = provider;
    service.pool = pool;
  });

  afterAll(async () => {
    // Remove test bucket and all its objects (cascade handles DB rows)
    await pool.query('DELETE FROM storage.buckets WHERE name = $1', [TEST_BUCKET]);
    await fs.rm(STORAGE_DIR, { recursive: true, force: true });
  });

  // ── per-test cleanup ──────────────────────────────────────────────────

  afterEach(async () => {
    // Wipe all object rows for this bucket so tests don't bleed into each other
    await pool.query('DELETE FROM storage.objects WHERE bucket = $1', [TEST_BUCKET]);
    // Wipe all files inside the bucket dir
    const bucketDir = path.join(STORAGE_DIR, TEST_BUCKET);
    const entries = await fs.readdir(bucketDir).catch(() => []);
    await Promise.all(entries.map((e) => fs.rm(path.join(bucketDir, e), { recursive: true, force: true })));
  });

  // ── tests ─────────────────────────────────────────────────────────────

  it('renames a root-level file in both DB and filesystem', async () => {
    await seedFile(TEST_BUCKET, 'photo.png');
    await seedObjectRow(pool, TEST_BUCKET, 'photo.png');

    const service = StorageService.getInstance();
    const result = await service.renameObject(TEST_BUCKET, 'photo.png', 'cover.png', '', true);

    // DB row updated
    expect(result.key).toBe('cover.png');
    expect(result.bucket).toBe(TEST_BUCKET);

    const { rows } = await pool.query(
      'SELECT key FROM storage.objects WHERE bucket = $1',
      [TEST_BUCKET]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('cover.png');

    // Old file gone, new file present
    await expect(
      fs.access(path.join(STORAGE_DIR, TEST_BUCKET, 'photo.png'))
    ).rejects.toThrow();
    const newContent = await fs.readFile(
      path.join(STORAGE_DIR, TEST_BUCKET, 'cover.png'),
      'utf8'
    );
    expect(newContent).toBe('hello');
  });

  it('preserves directory prefix when renaming a nested file', async () => {
    await seedFile(TEST_BUCKET, 'folder/photo.png');
    await seedObjectRow(pool, TEST_BUCKET, 'folder/photo.png');

    const service = StorageService.getInstance();
    const result = await service.renameObject(
      TEST_BUCKET,
      'folder/photo.png',
      'banner.png',
      '',
      true
    );

    expect(result.key).toBe('folder/banner.png');

    await expect(
      fs.access(path.join(STORAGE_DIR, TEST_BUCKET, 'folder', 'photo.png'))
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(STORAGE_DIR, TEST_BUCKET, 'folder', 'banner.png'))
    ).resolves.toBeUndefined();
  });

  it('returns 409 and leaves both files untouched when destination already exists', async () => {
    await seedFile(TEST_BUCKET, 'a.png', 'file-a');
    await seedObjectRow(pool, TEST_BUCKET, 'a.png');
    await seedFile(TEST_BUCKET, 'b.png', 'file-b');
    await seedObjectRow(pool, TEST_BUCKET, 'b.png');

    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'a.png', 'b.png', '', true)
    ).rejects.toMatchObject({ statusCode: 409 });

    // Both DB rows still intact
    const { rows } = await pool.query(
      'SELECT key FROM storage.objects WHERE bucket = $1 ORDER BY key',
      [TEST_BUCKET]
    );
    expect(rows.map((r: { key: string }) => r.key)).toEqual(['a.png', 'b.png']);

    // Both files still on disk
    await expect(fs.access(path.join(STORAGE_DIR, TEST_BUCKET, 'a.png'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(STORAGE_DIR, TEST_BUCKET, 'b.png'))).resolves.toBeUndefined();
  });

  it('returns 404 when the source key does not exist in DB', async () => {
    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'ghost.png', 'new.png', '', true)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 when DB row exists but file is missing from storage', async () => {
    // Insert only the DB row, no actual file
    await seedObjectRow(pool, TEST_BUCKET, 'orphan.png');

    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'orphan.png', 'new.png', '', true)
    ).rejects.toMatchObject({ statusCode: 404, message: 'Object file not found in storage' });
  });

  it('rejects empty new name with 400', async () => {
    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'photo.png', '   ', '', true)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects dot-segment names with 400', async () => {
    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'photo.png', '..', '', true)
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      service.renameObject(TEST_BUCKET, 'photo.png', '.', '', true)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects names with path separators with 400', async () => {
    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'photo.png', 'sub/evil.png', '', true)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects unchanged name with 400', async () => {
    const service = StorageService.getInstance();
    await expect(
      service.renameObject(TEST_BUCKET, 'photo.png', 'photo.png', '', true)
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('non-admin cannot rename a file uploaded by another user', async () => {
    await seedFile(TEST_BUCKET, 'secret.png');
    // Seed with no uploaded_by (NULL) — non-admin query requires uploaded_by match
    await seedObjectRow(pool, TEST_BUCKET, 'secret.png');

    const service = StorageService.getInstance();
    // This UUID was not the uploader (uploaded_by is NULL), isAdmin=false
    await expect(
      service.renameObject(
        TEST_BUCKET,
        'secret.png',
        'renamed.png',
        '00000000-0000-0000-0000-000000000999',
        false
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
