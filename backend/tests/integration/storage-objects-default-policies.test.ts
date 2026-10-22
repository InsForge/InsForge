import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(
    currentDir,
    '../../src/infra/database/migrations/066_storage-objects-default-owner-policies.sql'
  ),
  'utf8'
);

const DEFAULT_POLICIES = [
  'storage_objects_owner_delete',
  'storage_objects_owner_insert',
  'storage_objects_owner_select',
  'storage_objects_owner_update',
];

const USER_A = '550e8400-e29b-41d4-a716-446655440001';
const USER_B = '550e8400-e29b-41d4-a716-446655440002';

const asUser = (userId: string) => ({
  role: 'authenticated',
  'request.jwt.claims': JSON.stringify({ sub: userId }),
});

let pg: PgTestClient;
let db: PgTestClient;
let teardown: () => Promise<void>;

async function objectsPolicies(): Promise<string[]> {
  const { rows } = await pg.query(
    `SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass ORDER BY polname`
  );
  return rows.map((row: { polname: string }) => row.polname);
}

async function objectsRlsEnabled(): Promise<boolean> {
  const { rows } = await pg.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass`
  );
  return rows[0].relrowsecurity;
}

beforeAll(async () => {
  ({ pg, db, teardown } = await getConnections());

  // The migration chain ran with no bucket, so 066 is what added the defaults.
  // Fixtures are written by the superuser connection, which bypasses RLS.
  // Rows written through the S3 protocol have no uploaded_by.
  await pg.query(`
    INSERT INTO storage.buckets (name, public) VALUES
      ('public-assets', true),
      ('private-docs', false)
  `);
  await pg.query(
    `INSERT INTO storage.objects (bucket, key, size, uploaded_by, uploaded_via) VALUES
       ('private-docs', 'a.txt', 1, $1, 'rest'),
       ('private-docs', 'b.txt', 1, $2, 'rest'),
       ('public-assets', 'b-logo.png', 1, $2, 'rest'),
       ('private-docs', 's3-private.bin', 1, NULL, 's3'),
       ('public-assets', 's3-public.bin', 1, NULL, 's3')`,
    [USER_A, USER_B]
  );
});

afterAll(() => teardown());
beforeEach(() => db.beforeEach());
afterEach(() => db.afterEach());

describe('storage.objects defaults on a project migrated without a bucket', () => {
  it('has the four owner policies with RLS enabled', async () => {
    expect(await objectsPolicies()).toEqual(DEFAULT_POLICIES);
    expect(await objectsRlsEnabled()).toBe(true);
  });

  it('lets a user read their own objects and public-bucket objects only', async () => {
    db.setContext(asUser(USER_A));
    const { rows } = await db.query(`SELECT bucket, key FROM storage.objects ORDER BY bucket, key`);

    expect(rows).toEqual([
      { bucket: 'private-docs', key: 'a.txt' },
      { bucket: 'public-assets', key: 'b-logo.png' },
      { bucket: 'public-assets', key: 's3-public.bin' },
    ]);
  });

  it('lets a user upload, replace and delete their own objects', async () => {
    db.setContext(asUser(USER_A));

    await db.query(
      `INSERT INTO storage.objects (bucket, key, size, uploaded_by) VALUES ('private-docs', 'new.txt', 1, $1)`,
      [USER_A]
    );
    const upsert = await db.query(
      `INSERT INTO storage.objects (bucket, key, size, uploaded_by) VALUES ('private-docs', 'a.txt', 2, $1)
       ON CONFLICT (bucket, key) DO UPDATE SET size = EXCLUDED.size`,
      [USER_A]
    );
    expect(upsert.rowCount).toBe(1);

    const update = await db.query(
      `UPDATE storage.objects SET size = 3 WHERE bucket = 'private-docs' AND key = 'new.txt'`
    );
    expect(update.rowCount).toBe(1);

    const remove = await db.query(
      `DELETE FROM storage.objects WHERE bucket = 'private-docs' AND key IN ('a.txt', 'new.txt')`
    );
    expect(remove.rowCount).toBe(2);
  });

  it('does not let a user update or delete objects they did not upload', async () => {
    db.setContext(asUser(USER_A));

    const update = await db.query(
      `UPDATE storage.objects SET size = 9 WHERE uploaded_by = $1 OR uploaded_by IS NULL`,
      [USER_B]
    );
    expect(update.rowCount).toBe(0);

    const remove = await db.query(
      `DELETE FROM storage.objects WHERE uploaded_by = $1 OR uploaded_by IS NULL`,
      [USER_B]
    );
    expect(remove.rowCount).toBe(0);
  });

  it('does not let a user insert an object attributed to someone else', async () => {
    db.setContext(asUser(USER_A));

    await expect(
      db.query(
        `INSERT INTO storage.objects (bucket, key, size, uploaded_by) VALUES ('private-docs', 'x.txt', 1, $1)`,
        [USER_B]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a user replace an object they did not upload', async () => {
    db.setContext(asUser(USER_A));

    await expect(
      db.query(
        `INSERT INTO storage.objects (bucket, key, size, uploaded_by) VALUES ('private-docs', 'b.txt', 9, $1)
         ON CONFLICT (bucket, key) DO UPDATE SET size = EXCLUDED.size`,
        [USER_A]
      )
    ).rejects.toThrow(/row-level security/);
  });

  it('does not let a user replace an S3-written object, even in a public bucket', async () => {
    db.setContext(asUser(USER_A));

    await expect(
      db.query(
        `INSERT INTO storage.objects (bucket, key, size, uploaded_by) VALUES ('public-assets', 's3-public.bin', 9, $1)
         ON CONFLICT (bucket, key) DO UPDATE SET size = EXCLUDED.size`,
        [USER_A]
      )
    ).rejects.toThrow(/row-level security/);
  });
});

describe('re-running the migration', () => {
  it('is a no-op once the defaults exist', async () => {
    await pg.query(migrationSql);

    expect(await objectsPolicies()).toEqual(DEFAULT_POLICIES);
    expect(await objectsRlsEnabled()).toBe(true);
  });

  it('leaves a storage.objects that already has a custom policy untouched', async () => {
    await pg.query('BEGIN');
    try {
      await pg.query(`
        ${DEFAULT_POLICIES.map((name) => `DROP POLICY ${name} ON storage.objects;`).join('\n')}
        ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
        CREATE POLICY custom_read_all ON storage.objects FOR SELECT TO authenticated USING (true);
      `);

      await pg.query(migrationSql);

      expect(await objectsPolicies()).toEqual(['custom_read_all']);
      expect(await objectsRlsEnabled()).toBe(false);
    } finally {
      await pg.query('ROLLBACK');
    }
  });
});
