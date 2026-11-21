import { describe, it, beforeAll, afterAll, beforeEach, afterEach, expect } from 'vitest';
import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';
import { DatabaseTableService } from '../../src/services/database/database-table.service';
import { DatabaseManager } from '../../src/infra/database/database.manager';
import { appConfig } from '../../src/infra/config/app.config';

let pg: PgTestClient;
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
  ({ pg, db, teardown } = await getConnections());

  const cfg = pg.config;
  process.env.POSTGRES_HOST = String(cfg.host ?? 'localhost');
  process.env.POSTGRES_PORT = String(cfg.port ?? 5432);
  process.env.POSTGRES_DB = String(cfg.database);
  process.env.POSTGRES_USER = String(cfg.user ?? 'postgres');
  process.env.POSTGRES_PASSWORD = String(cfg.password ?? 'postgres');

  appConfig.database.host = String(cfg.host ?? 'localhost');
  appConfig.database.port = Number(cfg.port ?? 5432);
  appConfig.database.name = String(cfg.database);
  appConfig.database.user = String(cfg.user ?? 'postgres');
  appConfig.database.password = String(cfg.password ?? 'postgres');

  try {
    await DatabaseManager.getInstance().initialize();
  } catch {
    // Already initialized or non-critical in test harness
  }

  await pg.query(`
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
  try {
    await DatabaseManager.getInstance().close();
  } catch {
    // Ignore cleanup error if pool was not active
  }
  if (teardown) {
    await teardown();
  }
});
beforeEach(() => db.beforeEach());
afterEach(async () => {
  await db.afterEach();
  // Drop tables touched through `db` only after `db.afterEach()` rolls back
  // and releases all transaction locks, preventing DROP TABLE deadlocks.
  await pg.query(`
    DROP TABLE IF EXISTS auto_rls_probe;
    DROP TABLE IF EXISTS auto_rls_idem_ctas;
    DROP TABLE IF EXISTS auto_rls_idem;
  `);
});

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
    await pg.query(`CREATE TABLE auto_rls_probe (id INT PRIMARY KEY, content TEXT)`);
    const row = await pg.one(
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
    try {
      await pg.query(`
        CREATE TABLE auto_rls_partitioned (
          id INT,
          region TEXT NOT NULL,
          PRIMARY KEY (id, region)
        ) PARTITION BY LIST (region);

        CREATE TABLE auto_rls_part_east PARTITION OF auto_rls_partitioned
          FOR VALUES IN ('east');
      `);

      const rootRow = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_partitioned'`
      );
      expect(rootRow.relrowsecurity).toBe(true);

      const partRow = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_part_east'`
      );
      expect(partRow.relrowsecurity).toBe(true);
    } finally {
      await pg.query(`
        DROP TABLE IF EXISTS auto_rls_part_east;
        DROP TABLE IF EXISTS auto_rls_partitioned;
      `);
    }
  });

  it('should not enable RLS on temporary tables', async () => {
    try {
      await pg.query(`CREATE TEMP TABLE auto_rls_temp (id INT PRIMARY KEY)`);
      const row = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_temp' AND relnamespace = pg_my_temp_schema()`
      );
      expect(row.relrowsecurity).toBe(false);
    } finally {
      await pg.query(`DROP TABLE IF EXISTS auto_rls_temp`);
    }
  });

  it('should not enable RLS on tables created in custom non-public schemas', async () => {
    try {
      await pg.query(`
        CREATE SCHEMA IF NOT EXISTS custom_scope;
        CREATE TABLE custom_scope.auto_rls_custom (id INT PRIMARY KEY);
      `);
      const row = await pg.one(
        `SELECT c.relrowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'custom_scope' AND c.relname = 'auto_rls_custom'`
      );
      expect(row.relrowsecurity).toBe(false);
    } finally {
      await pg.query(`DROP SCHEMA IF EXISTS custom_scope CASCADE`);
    }
  });

  it('should automatically enable RLS on tables created via CREATE TABLE AS and SELECT INTO', async () => {
    try {
      await pg.query(`
        CREATE TABLE auto_rls_source (id INT PRIMARY KEY, val TEXT);
        INSERT INTO auto_rls_source VALUES (1, 'hello');

        CREATE TABLE auto_rls_ctas AS SELECT * FROM auto_rls_source;
        SELECT * INTO auto_rls_select_into FROM auto_rls_source;
      `);

      const ctasRow = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_ctas'`
      );
      expect(ctasRow.relrowsecurity).toBe(true);

      const selectIntoRow = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_select_into'`
      );
      expect(selectIntoRow.relrowsecurity).toBe(true);
    } finally {
      await pg.query(`
        DROP TABLE IF EXISTS auto_rls_ctas;
        DROP TABLE IF EXISTS auto_rls_select_into;
        DROP TABLE IF EXISTS auto_rls_source;
      `);
    }
  });

  it('should automatically enable RLS on multiple tables created in a multi-statement DDL batch', async () => {
    try {
      await pg.query(`
        CREATE TABLE auto_rls_multi_1 (id INT PRIMARY KEY);
        CREATE TABLE auto_rls_multi_2 (id INT PRIMARY KEY);
      `);

      const row1 = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_1'`
      );
      const row2 = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_2'`
      );
      expect(row1.relrowsecurity).toBe(true);
      expect(row2.relrowsecurity).toBe(true);

      // Subsequent manual DDL on an enabled table executes cleanly
      await pg.query(`ALTER TABLE auto_rls_multi_1 ENABLE ROW LEVEL SECURITY;`);
      const row1After = await pg.one(
        `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_multi_1'`
      );
      expect(row1After.relrowsecurity).toBe(true);
    } finally {
      await pg.query(`
        DROP TABLE IF EXISTS auto_rls_multi_1;
        DROP TABLE IF EXISTS auto_rls_multi_2;
      `);
    }
  });

  it('ensures RLS remains enabled after CREATE TABLE IF NOT EXISTS on existing tables and is applied to CTAS tables', async () => {
    // 1. Initial CREATE TABLE creates the table and fires the auto_enable_rls() event trigger
    await pg.query(`CREATE TABLE auto_rls_idem (id INT PRIMARY KEY, content TEXT);`);
    const initialRow = await pg.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_idem'`
    );
    expect(initialRow.relrowsecurity).toBe(true);

    // 2. CREATE TABLE IF NOT EXISTS on the existing table executes cleanly without error
    // and confirms RLS remains enabled on the table.
    await pg.query(`CREATE TABLE IF NOT EXISTS auto_rls_idem (id INT PRIMARY KEY, content TEXT);`);
    const repeatRow = await pg.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_idem'`
    );
    expect(repeatRow.relrowsecurity).toBe(true);

    // 3. CTAS statement creates a new table and exercises the event trigger, auto-enabling RLS
    await pg.query(`CREATE TABLE auto_rls_idem_ctas AS SELECT * FROM auto_rls_idem;`);
    const ctasRow = await pg.one(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'auto_rls_idem_ctas'`
    );
    expect(ctasRow.relrowsecurity).toBe(true);

    // 4. Verify restricted role default-deny enforcement on both tables
    db.setContext({ role: 'anon' });
    const { rows: anonRows1 } = await db.query(`SELECT * FROM auto_rls_idem`);
    expect(anonRows1).toHaveLength(0);
    const { rows: anonRows2 } = await db.query(`SELECT * FROM auto_rls_idem_ctas`);
    expect(anonRows2).toHaveLength(0);

    // Verify write is rejected by RLS
    await expect(
      db.query(`INSERT INTO auto_rls_idem (id, content) VALUES (1, 'leak')`)
    ).rejects.toThrow(/violates row-level security policy/);

    // Roll back to savepoint to clear aborted transaction state before testing the next table
    await db.rollback();
    await db.savepoint();

    await expect(
      db.query(`INSERT INTO auto_rls_idem_ctas (id, content) VALUES (1, 'leak')`)
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it('should include underscore-prefixed public tables in DatabaseTableService.getTableRlsStatuses() while excluding temporary and non-public tables', async () => {
    const tableService = DatabaseTableService.getInstance();
    try {
      // 1. Create a legitimate public table beginning with an underscore
      await pg.query(`CREATE TABLE _audit_events (id INT PRIMARY KEY, action TEXT);`);

      // 2. Create a temporary table beginning with an underscore
      await pg.query(`CREATE TEMP TABLE _temp_internal (id INT PRIMARY KEY);`);

      // 3. Create a non-public schema table beginning with an underscore
      await pg.query(`
        CREATE SCHEMA IF NOT EXISTS custom_scope;
        CREATE TABLE custom_scope._scoped_internal (id INT PRIMARY KEY);
      `);

      // 4. Query production service method DatabaseTableService.getTableRlsStatuses for 'public'
      const publicStatuses = await tableService.getTableRlsStatuses('public');
      const publicTableNames = publicStatuses.map((s) => s.tableName);

      // Verify underscore-prefixed public table appears in service result with rlsEnabled: true
      expect(publicTableNames).toContain('_audit_events');
      const auditEntry = publicStatuses.find((s) => s.tableName === '_audit_events');
      expect(auditEntry).toBeDefined();
      expect(auditEntry?.schemaName).toBe('public');
      expect(auditEntry?.rlsEnabled).toBe(true);

      // Temporary table and non-public schema table must be excluded from public schema results
      expect(publicTableNames).not.toContain('_temp_internal');
      expect(publicTableNames).not.toContain('_scoped_internal');

      // 5. Query production service method DatabaseTableService.getTableRlsStatuses for 'custom_scope'
      const customStatuses = await tableService.getTableRlsStatuses('custom_scope');
      const customTableNames = customStatuses.map((s) => s.tableName);

      expect(customTableNames).toContain('_scoped_internal');
      expect(customTableNames).not.toContain('_audit_events');
      expect(customTableNames).not.toContain('_temp_internal');
      const customEntry = customStatuses.find((s) => s.tableName === '_scoped_internal');
      expect(customEntry?.rlsEnabled).toBe(false);
    } finally {
      await pg.query(`
        DROP TABLE IF EXISTS _audit_events;
        DROP TABLE IF EXISTS _temp_internal;
        DROP TABLE IF EXISTS custom_scope._scoped_internal;
        DROP SCHEMA IF EXISTS custom_scope CASCADE;
      `);
    }
  });
});
