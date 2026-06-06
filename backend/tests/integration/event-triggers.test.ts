import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

let db: PgTestClient;
let teardown: () => Promise<void>;

beforeAll(async () => {
  ({ db, teardown } = await getConnections());
});

afterAll(() => teardown());

describe('auto-RLS event triggers', () => {
  it('should auto-create project_admin_policy when table has RLS at creation', async () => {
    await db.query(`
      CREATE TABLE trigger_test_a (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT
      );
      ALTER TABLE trigger_test_a ENABLE ROW LEVEL SECURITY;
    `);

    const { rows } = await db.query(
      `SELECT policyname, roles FROM pg_policies
       WHERE tablename = 'trigger_test_a' AND policyname = 'project_admin_policy'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].roles).toContain('project_admin');
  });

  it('should auto-create project_admin_policy when RLS is enabled via ALTER TABLE', async () => {
    await db.query(`
      CREATE TABLE trigger_test_b (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT
      );
    `);

    // No policies yet
    const before = await db.query(`SELECT * FROM pg_policies WHERE tablename = 'trigger_test_b'`);
    expect(before.rows).toHaveLength(0);

    // Enable RLS — event trigger should fire
    await db.query(`ALTER TABLE trigger_test_b ENABLE ROW LEVEL SECURITY`);

    const after = await db.query(
      `SELECT policyname, roles FROM pg_policies
       WHERE tablename = 'trigger_test_b' AND policyname = 'project_admin_policy'`
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].roles).toContain('project_admin');
  });

  it('should not create duplicate policy if one already exists', async () => {
    await db.query(`
      CREATE TABLE trigger_test_c (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT
      );
      ALTER TABLE trigger_test_c ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "custom_policy" ON trigger_test_c FOR SELECT TO authenticated USING (true);
    `);

    // ALTER TABLE again — trigger fires but should skip since a policy exists
    await db.query(`ALTER TABLE trigger_test_c FORCE ROW LEVEL SECURITY`);

    const { rows } = await db.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'trigger_test_c'`
    );
    const policyNames = rows.map((r: { policyname: string }) => r.policyname);
    expect(policyNames).toContain('custom_policy');
    const adminCount = policyNames.filter((n: string) => n === 'project_admin_policy').length;
    expect(adminCount).toBe(1);
  });
});
