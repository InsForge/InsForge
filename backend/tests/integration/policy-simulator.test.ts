import { Pool } from 'pg';
import type { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';
import { PolicySimulatorService } from '@/services/database/policy-simulator.service.js';

/**
 * Integration coverage for the RLS policy simulator.
 *
 * The simulator runs its operations on a SEPARATE pool connection (so its
 * BEGIN/ROLLBACK never touches the test harness transaction). We seed the
 * fixture through `db`, then `db.publish()` to commit so that separate pool
 * connection can see the table, policies, and rows.
 */

const USER_A = '550e8400-e29b-41d4-a716-446655440001';
const USER_B = '550e8400-e29b-41d4-a716-446655440002';

const simulator = PolicySimulatorService.getInstance();

let db: PgTestClient;
let pool: Pool;
let teardown: () => Promise<void>;

beforeAll(async () => {
  const conn = await getConnections();
  db = conn.db;
  teardown = conn.teardown;
  pool = conn.manager.getPool(db.config);

  await db.query(`
    CREATE TABLE todos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false
    );
    ALTER TABLE todos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_select ON todos FOR SELECT TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY owner_insert ON todos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
    CREATE POLICY owner_update ON todos FOR UPDATE TO authenticated USING (auth.uid() = user_id);
    CREATE POLICY owner_delete ON todos FOR DELETE TO authenticated USING (auth.uid() = user_id);
    GRANT ALL ON todos TO authenticated, project_admin;
    -- anon can reach the table but has no policy, so RLS denies every row.
    GRANT SELECT ON todos TO anon;
    INSERT INTO todos (user_id, title) VALUES
      ('${USER_A}', 'a-one'),
      ('${USER_A}', 'a-two'),
      ('${USER_B}', 'b-one');

    -- Custom-claim table: visibility scoped by an org_id JWT claim.
    CREATE TABLE docs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id TEXT NOT NULL,
      title TEXT NOT NULL
    );
    ALTER TABLE docs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY org_select ON docs FOR SELECT TO authenticated
      USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'org_id') = org_id);
    GRANT SELECT ON docs TO authenticated, project_admin;
    INSERT INTO docs (org_id, title) VALUES ('acme', 'acme-doc'), ('globex', 'globex-doc');

    -- A view to prove the simulator rejects non-base-table relations.
    CREATE VIEW todos_view AS SELECT * FROM todos;
    GRANT SELECT ON todos_view TO authenticated;

    -- A table project_admin cannot read, to prove the admin baseline degrades
    -- gracefully (rowsTotal=null) instead of failing the whole simulation.
    CREATE TABLE no_admin_grant (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      title TEXT NOT NULL
    );
    ALTER TABLE no_admin_grant ENABLE ROW LEVEL SECURITY;
    CREATE POLICY owner_select ON no_admin_grant FOR SELECT TO authenticated USING (auth.uid() = user_id);
    GRANT SELECT ON no_admin_grant TO authenticated;
    REVOKE ALL ON no_admin_grant FROM project_admin;
    INSERT INTO no_admin_grant (user_id, title) VALUES ('${USER_A}', 'private');
  `);

  await db.publish();
});

afterAll(async () => {
  await teardown();
});

describe('SELECT simulation', () => {
  it('reports the owner sees only their rows (partial)', async () => {
    const res = await simulator.simulate(
      { table: 'todos', operation: 'SELECT', role: 'authenticated', claims: { sub: USER_A } },
      pool
    );
    expect(res.decision).toBe('partial');
    expect(res.rowsVisible).toBe(2);
    expect(res.rowsTotal).toBe(3);
    expect(res.rlsEnabled).toBe(true);
    expect(res.bypassRls).toBe(false);
    expect(res.sampleRows).toHaveLength(2);
  });

  it('denies anon (table privilege but no policy)', async () => {
    const res = await simulator.simulate(
      { table: 'todos', operation: 'SELECT', role: 'anon' },
      pool
    );
    expect(res.decision).toBe('denied');
    expect(res.rowsVisible).toBe(0);
    expect(res.rowsTotal).toBe(3);
    expect(res.applicablePolicies).toHaveLength(0); // owner_* policies target authenticated
  });

  it('reports project_admin as bypass, not allowed-by-policy', async () => {
    const res = await simulator.simulate(
      { table: 'todos', operation: 'SELECT', role: 'project_admin' },
      pool
    );
    expect(res.decision).toBe('bypass');
    expect(res.bypassRls).toBe(true);
    expect(res.rowsVisible).toBe(3);
    expect(res.explanation).toContain('BYPASSRLS');
  });

  it('lists the applicable policy for an authenticated SELECT', async () => {
    const res = await simulator.simulate(
      { table: 'todos', operation: 'SELECT', role: 'authenticated', claims: { sub: USER_A } },
      pool
    );
    const names = res.applicablePolicies.map((p) => p.policyName);
    expect(names).toContain('owner_select');
    const policy = res.applicablePolicies.find((p) => p.policyName === 'owner_select');
    expect(policy?.permissive).toBe(true);
    expect(policy?.cmd).toBe('SELECT');
  });

  it('honors custom JWT claims (org_id scoping)', async () => {
    const acme = await simulator.simulate(
      {
        table: 'docs',
        operation: 'SELECT',
        role: 'authenticated',
        claims: { sub: USER_A, org_id: 'acme' },
      },
      pool
    );
    expect(acme.rowsVisible).toBe(1);
    expect(acme.effectiveClaims.org_id).toBe('acme');

    const globex = await simulator.simulate(
      {
        table: 'docs',
        operation: 'SELECT',
        role: 'authenticated',
        claims: { sub: USER_A, org_id: 'globex' },
      },
      pool
    );
    expect(globex.rowsVisible).toBe(1);
  });
});

describe('INSERT simulation', () => {
  it('allows an owner to insert their own row', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'INSERT',
        role: 'authenticated',
        claims: { sub: USER_A },
        row: { user_id: USER_A, title: 'new' },
      },
      pool
    );
    expect(res.decision).toBe('allowed');
    expect(res.rowsAffected).toBe(1);
  });

  it('denies inserting a row owned by someone else (WITH CHECK)', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'INSERT',
        role: 'authenticated',
        claims: { sub: USER_A },
        row: { user_id: USER_B, title: 'spoof' },
      },
      pool
    );
    expect(res.decision).toBe('denied');
    expect(res.denialReason).toMatch(/row-level security/i);
  });

  it('has no side effects: the inserted row is rolled back', async () => {
    const before = await pool.query('SELECT count(*)::int AS n FROM todos');
    await simulator.simulate(
      {
        table: 'todos',
        operation: 'INSERT',
        role: 'authenticated',
        claims: { sub: USER_A },
        row: { user_id: USER_A, title: 'ephemeral' },
      },
      pool
    );
    const after = await pool.query('SELECT count(*)::int AS n FROM todos');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('UPDATE / DELETE simulation', () => {
  it('allows an owner to update their own rows', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'UPDATE',
        role: 'authenticated',
        claims: { sub: USER_A },
        row: { done: true },
        match: { user_id: USER_A },
      },
      pool
    );
    expect(res.decision).toBe('allowed');
    expect(res.rowsAffected).toBe(2);
    expect(res.rowsTotal).toBe(2);
  });

  it('denies updating another users rows (USING hides them)', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'UPDATE',
        role: 'authenticated',
        claims: { sub: USER_B },
        row: { title: 'hacked' },
        match: { user_id: USER_A },
      },
      pool
    );
    expect(res.decision).toBe('denied');
    expect(res.rowsAffected).toBe(0);
    expect(res.rowsTotal).toBe(2);
  });

  it('denies an UPDATE that would reassign ownership (WITH CHECK)', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'UPDATE',
        role: 'authenticated',
        claims: { sub: USER_A },
        row: { user_id: USER_B },
        match: { user_id: USER_A },
      },
      pool
    );
    expect(res.decision).toBe('denied');
    expect(res.denialReason).toMatch(/row-level security/i);
  });

  it('requires a row payload for UPDATE', async () => {
    await expect(
      simulator.simulate(
        { table: 'todos', operation: 'UPDATE', role: 'authenticated', claims: { sub: USER_A } },
        pool
      )
    ).rejects.toThrow(/row/i);
  });

  it('denies deleting another users rows', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'DELETE',
        role: 'authenticated',
        claims: { sub: USER_B },
        match: { user_id: USER_A },
      },
      pool
    );
    expect(res.decision).toBe('denied');
    expect(res.rowsAffected).toBe(0);
  });

  it('allows an owner to delete their own rows (rolled back)', async () => {
    const res = await simulator.simulate(
      {
        table: 'todos',
        operation: 'DELETE',
        role: 'authenticated',
        claims: { sub: USER_A },
        match: { user_id: USER_A },
      },
      pool
    );
    expect(res.decision).toBe('allowed');
    expect(res.rowsAffected).toBe(2);

    const after = await pool.query('SELECT count(*)::int AS n FROM todos');
    expect(after.rows[0].n).toBe(3); // delete was rolled back
  });
});

describe('validation', () => {
  it('rejects an unknown table', async () => {
    await expect(
      simulator.simulate(
        { table: 'does_not_exist', operation: 'SELECT', role: 'authenticated' },
        pool
      )
    ).rejects.toThrow(/does not exist/i);
  });

  it('rejects a view (not a base table)', async () => {
    await expect(
      simulator.simulate({ table: 'todos_view', operation: 'SELECT', role: 'authenticated' }, pool)
    ).rejects.toThrow(/not a base table/i);
  });

  it('degrades gracefully when project_admin cannot read the table (null baseline)', async () => {
    // The owner can see their own row, but the admin baseline cannot be computed.
    const res = await simulator.simulate(
      {
        table: 'no_admin_grant',
        operation: 'SELECT',
        role: 'authenticated',
        claims: { sub: USER_A },
      },
      pool
    );
    expect(res.rowsTotal).toBeNull();
    expect(res.rowsVisible).toBe(1);
    expect(res.decision).toBe('allowed');
    expect(res.explanation).toMatch(/baseline unavailable/i);
  });
});
