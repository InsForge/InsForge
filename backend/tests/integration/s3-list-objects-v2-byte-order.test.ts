import { describe, beforeAll, afterAll, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { getConnections } from './utils';

/**
 * S3 ListObjectsV2 against a real migrated database.
 *
 * The unit tests fake storage.objects with JavaScript string ordering, which
 * cannot show what the database's collation does to the listing. Under a
 * linguistic collation such as en_US.utf8 (the bundled image's default)
 * punctuation is ignored, so "a-c" sorts between "a/b" and "a/d" and the "a/"
 * group is no longer contiguous. This suite pins the byte-order listing S3
 * specifies, across pages, on the real query and index.
 *
 * The service reads connection settings from the environment at module load, so
 * env is pointed at the isolated pgsql-test database before it is imported.
 */

type ManagerModule = typeof import('../../src/infra/database/database.manager').DatabaseManager;
type Handler = typeof import('../../src/api/routes/s3-gateway/commands/list-objects-v2').handle;

const BUCKET = 'byte-order';
const KEYS = ['a/b', 'a-c', 'a/d', 'a/e'];

let teardown: (() => Promise<void>) | undefined;
let dbManager: InstanceType<ManagerModule>;
let handle: Handler;

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const result = await dbManager.getPool().query(sql, params);
  return result.rows as T[];
}

/** Runs one ListObjectsV2 request through the real handler. */
async function listPage(params: Record<string, string>) {
  const send = vi.fn();
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    send,
  } as unknown as Response;
  const req = {
    query: params,
    path: `/${BUCKET}`,
    s3Bucket: BUCKET,
    s3Key: null,
    s3Op: 'ListObjectsV2',
    s3Auth: { requestId: 'integration' },
  };

  await handle(req as never, res);

  const xml = send.mock.calls[0][0] as string;
  const captureAll = (tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, 'g'))].map((m) => m[1]);
  return {
    entries: [...captureAll('Key'), ...captureAll('Prefix').filter((p) => p !== '')],
    nextToken: xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1],
  };
}

/** Walks every page the way an SDK paginator does. */
async function listAllPages(params: Record<string, string>): Promise<string[]> {
  const entries: string[] = [];
  let token: string | undefined;
  let pages = 0;
  do {
    const page = await listPage(token ? { ...params, 'continuation-token': token } : params);
    entries.push(...page.entries);
    token = page.nextToken;
    pages++;
  } while (token && pages < 20);
  return entries;
}

beforeAll(async () => {
  const conn = await getConnections();
  teardown = conn.teardown;
  const cfg = conn.pg.config;

  process.env.POSTGRES_HOST = String(cfg.host ?? 'localhost');
  process.env.POSTGRES_PORT = String(cfg.port ?? 5432);
  process.env.POSTGRES_DB = String(cfg.database);
  process.env.POSTGRES_USER = String(cfg.user ?? 'postgres');
  process.env.POSTGRES_PASSWORD = String(cfg.password ?? 'postgres');

  const { DatabaseManager } = await import('../../src/infra/database/database.manager');
  const { appConfig } = await import('../../src/infra/config/app.config');
  ({ handle } = await import('../../src/api/routes/s3-gateway/commands/list-objects-v2'));
  dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  appConfig.app.jwtSecret = 'integration-secret-long-enough-for-signing';

  await query('INSERT INTO storage.buckets (name) VALUES ($1)', [BUCKET]);
  for (const key of KEYS) {
    await query('INSERT INTO storage.objects (bucket, key, size) VALUES ($1, $2, 1)', [
      BUCKET,
      key,
    ]);
  }
}, 180_000);

afterAll(async () => {
  await dbManager?.close();
  await teardown?.();
});

describe('S3 ListObjectsV2 byte order on a real database', () => {
  it('runs on a collation that interleaves the "a/" group', async () => {
    // Guards the premise of this suite: under byte order "a-c" sorts first,
    // under the default collation it lands inside the "a/" group.
    const rows = await query<{ key: string }>(
      'SELECT key FROM storage.objects WHERE bucket = $1 ORDER BY key',
      [BUCKET]
    );
    expect(rows.map((r) => r.key)).toEqual(['a/b', 'a-c', 'a/d', 'a/e']);
  });

  it('returns each CommonPrefix once across pages', async () => {
    const entries = await listAllPages({ delimiter: '/', 'max-keys': '1' });
    expect(entries).toEqual(['a-c', 'a/']);
  });

  it('lists keys in UTF-8 byte order', async () => {
    const entries = await listAllPages({ 'max-keys': '2' });
    expect(entries).toEqual(['a-c', 'a/b', 'a/d', 'a/e']);
  });

  it('backs the listing with a byte-order index', async () => {
    const rows = await query<{ def: string }>(
      "SELECT pg_get_indexdef('storage.idx_storage_objects_bucket_key_c'::regclass) AS def"
    );
    expect(rows[0].def).toContain('(bucket, key COLLATE "C")');
  });
});
