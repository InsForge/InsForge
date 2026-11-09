import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

const USER_A = '550e8400-e29b-41d4-a716-446655440001';
const USER_B = '550e8400-e29b-41d4-a716-446655440002';
const USER_C = '550e8400-e29b-41d4-a716-446655440003';

const asUser = (userId: string) => ({
  role: 'authenticated',
  'request.jwt.claims': JSON.stringify({ sub: userId }),
});

beforeAll(async () => {
  ({ db, teardown } = await getConnections());

  await db.query(`
    CREATE TABLE todos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL DEFAULT auth.uid(),
      title TEXT NOT NULL,
      done BOOLEAN DEFAULT false
    );
    ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "owner_select" ON todos FOR SELECT
      TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY "owner_insert" ON todos FOR INSERT
      TO authenticated WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "owner_update" ON todos FOR UPDATE
      TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY "owner_delete" ON todos FOR DELETE
      TO authenticated USING (auth.uid() = user_id);
    GRANT ALL ON todos TO authenticated;
  `);
});

afterAll(async () => {
  if (teardown) {
    await teardown();
  }
});
beforeEach(() => db.beforeEach());
afterEach(() => db.afterEach());

describe('owner crud', () => {
  it('should allow user to create their own todo', async () => {
    db.setContext(asUser(USER_A));

    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING *`, ['Buy milk']);

    expect(todo.title).toBe('Buy milk');
    expect(todo.user_id).toBe(USER_A);
  });

  it('should allow user to read only their own todos', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Task A']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Task B']);

    db.setContext(asUser(USER_A));
    const rows = await db.many(`SELECT * FROM todos`);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Task A');
  });

  it('should allow user to update their own todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Draft']);

    const updated = await db.one(`UPDATE todos SET title = $1 WHERE id = $2 RETURNING *`, [
      'Final',
      todo.id,
    ]);
    expect(updated.title).toBe('Final');
  });

  it('should allow user to delete their own todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Remove me']);

    const result = await db.query(`DELETE FROM todos WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(1);
  });
});

describe('cross-user isolation', () => {
  it('should prevent user from seeing another users todos', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Secret']);

    db.setContext(asUser(USER_B));
    const { rows } = await db.query(`SELECT * FROM todos`);
    expect(rows).toHaveLength(0);
  });

  it('should prevent user from updating another users todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Private']);

    db.setContext(asUser(USER_B));
    const result = await db.query(`UPDATE todos SET title = 'hacked' WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(0);
  });

  it('should prevent user from deleting another users todo', async () => {
    db.setContext(asUser(USER_A));
    const todo = await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Keep me']);

    db.setContext(asUser(USER_B));
    const result = await db.query(`DELETE FROM todos WHERE id = $1`, [todo.id]);
    expect(result.rowCount).toBe(0);
  });

  it('should isolate three users from each other', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['A task']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['B task']);

    db.setContext(asUser(USER_C));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['C task']);

    // Each user sees only their own
    db.setContext(asUser(USER_A));
    const aRows = await db.many(`SELECT * FROM todos`);
    expect(aRows).toHaveLength(1);
    expect(aRows[0].title).toBe('A task');

    db.setContext(asUser(USER_B));
    const bRows = await db.many(`SELECT * FROM todos`);
    expect(bRows).toHaveLength(1);
    expect(bRows[0].title).toBe('B task');

    db.setContext(asUser(USER_C));
    const cRows = await db.many(`SELECT * FROM todos`);
    expect(cRows).toHaveLength(1);
    expect(cRows[0].title).toBe('C task');
  });
});

describe('role access control', () => {
  it('should block anon from reading any data', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Exists']);

    db.setContext({ role: 'anon' });
    const { rows } = await db.query(`SELECT * FROM todos`);
    expect(rows).toHaveLength(0);
  });

  it('should allow project_admin to bypass RLS via BYPASSRLS role attribute', async () => {
    db.setContext(asUser(USER_A));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Admin can see me']);

    db.setContext(asUser(USER_B));
    await db.one(`INSERT INTO todos (title) VALUES ($1) RETURNING id`, ['Admin sees this too']);

    // project_admin has BYPASSRLS — no per-table policy needed
    db.setContext({ role: 'project_admin' });
    const rows = await db.many(`SELECT * FROM todos`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('should confirm no project_admin_policy exists on the table', async () => {
    const { rows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'todos' AND policyname = 'project_admin_policy'`
    );
    expect(rows).toHaveLength(0);
  });

  it('should automatically enable RLS on newly created tables in public', async () => {
    await db.query(`CREATE TABLE auto_rls_probe (id INT PRIMARY KEY, content TEXT)`);
    const row = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_probe'`
    );
    expect(row.relrowsecurity).toBe(true);

    // anon should be blocked by default-deny
    db.setContext({ role: 'anon' });
    const { rows } = await db.query(`SELECT * FROM auto_rls_probe`);
    expect(rows).toHaveLength(0);

    await expect(
      db.query(`INSERT INTO auto_rls_probe (id, content) VALUES (1, 'leak')`)
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it('should automatically enable RLS on partitioned table root and its partitions in public', async () => {
    await db.query(`
      CREATE TABLE auto_rls_partitioned (
        id INT,
        region TEXT NOT NULL,
        PRIMARY KEY (id, region)
      ) PARTITION BY LIST (region);

      CREATE TABLE auto_rls_part_east PARTITION OF auto_rls_partitioned
        FOR VALUES IN ('east');
    `);

    const rootRow = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_partitioned'`
    );
    expect(rootRow.relrowsecurity).toBe(true);

    const partRow = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_part_east'`
    );
    expect(partRow.relrowsecurity).toBe(true);
  });

  it('should not enable RLS on temporary tables', async () => {
    await db.query(`CREATE TEMP TABLE auto_rls_temp (id INT PRIMARY KEY)`);
    const row = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_temp' AND relnamespace = pg_my_temp_schema()`
    );
    expect(row.relrowsecurity).toBe(false);
  });

  it('should not enable RLS on tables created in custom non-public schemas', async () => {
    await db.query(`
      CREATE SCHEMA IF NOT EXISTS custom_scope;
      CREATE TABLE custom_scope.auto_rls_custom (id INT PRIMARY KEY);
    `);
    const row = await db.one(
      `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'custom_scope' AND c.relname = 'auto_rls_custom'`
    );
    expect(row.relrowsecurity).toBe(false);
  });

  it('should automatically enable RLS on tables created via CREATE TABLE AS and SELECT INTO', async () => {
    await db.query(`
      CREATE TABLE auto_rls_source (id INT PRIMARY KEY, val TEXT);
      INSERT INTO auto_rls_source VALUES (1, 'hello');

      CREATE TABLE auto_rls_ctas AS SELECT * FROM auto_rls_source;
      SELECT * INTO auto_rls_select_into FROM auto_rls_source;
    `);

    const ctasRow = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_ctas'`
    );
    expect(ctasRow.relrowsecurity).toBe(true);

    const selectIntoRow = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_select_into'`
    );
    expect(selectIntoRow.relrowsecurity).toBe(true);
  });

  it('should remain idempotent when executing repeated or multi-table DDL', async () => {
    await db.query(`
      CREATE TABLE auto_rls_multi_1 (id INT PRIMARY KEY);
      CREATE TABLE auto_rls_multi_2 (id INT PRIMARY KEY);
    `);

    const row1 = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_1'`
    );
    const row2 = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_2'`
    );
    expect(row1.relrowsecurity).toBe(true);
    expect(row2.relrowsecurity).toBe(true);

    // Re-enabling or subsequent DDL succeeds idempotently
    await db.query(`ALTER TABLE auto_rls_multi_1 ENABLE ROW LEVEL SECURITY;`);
    const row1After = await db.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_1'`
    );
    expect(row1After.relrowsecurity).toBe(true);
  });
});
