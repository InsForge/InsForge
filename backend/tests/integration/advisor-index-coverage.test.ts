import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { getConnections } from './utils';

/**
 * What counts as a covering index, for the two advisor rules that ask.
 *
 * pg_index.indkey lists the INCLUDE payload after the key columns, and
 * indnkeyatts is where the key columns stop. A payload column is stored in the
 * index but cannot be searched on, so an index that merely carries a column
 * along does not let Postgres filter by it or satisfy a foreign key. Both rules
 * read indkey whole, so such an index silently suppressed a real finding.
 *
 * The service reads connection settings from the environment at module load, so
 * env is pointed at the isolated pgsql-test database before it is imported.
 */

type AdvisorService =
  typeof import('../../src/services/database/database-advisor.service').DatabaseAdvisorService;
type ManagerModule = typeof import('../../src/infra/database/database.manager').DatabaseManager;

let teardown: (() => Promise<void>) | undefined;
let svc: InstanceType<AdvisorService>;
let dbManager: InstanceType<ManagerModule>;

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const result = await dbManager.getPool().query(sql, params);
  return result.rows as T[];
}

/** Runs one scan to completion and returns the affected objects for a rule. */
async function scanFor(ruleId: string): Promise<string[]> {
  const scanId = await svc.triggerScan('manual');

  const deadline = Date.now() + 60_000;
  while (svc.isScanInProgress() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (svc.isScanInProgress()) {
    throw new Error('advisor scan did not finish in time');
  }

  const rows = await query<{ affectedObject: string }>(
    `SELECT affected_object AS "affectedObject"
       FROM system.advisor_findings
      WHERE scan_id = $1 AND rule_id = $2
      ORDER BY affected_object`,
    [scanId, ruleId]
  );
  return rows.map((r) => r.affectedObject);
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
  const { DatabaseAdvisorService } =
    await import('../../src/services/database/database-advisor.service');
  dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  svc = DatabaseAdvisorService.getInstance();

  await query(`
    -- Foreign key whose second column is only carried as an INCLUDE payload.
    CREATE TABLE public.fk_parent (a uuid, b uuid, UNIQUE (a, b));
    CREATE TABLE public.fk_child (
      id uuid PRIMARY KEY,
      a  uuid NOT NULL,
      b  uuid NOT NULL,
      CONSTRAINT fk_child_fkey FOREIGN KEY (a, b) REFERENCES public.fk_parent (a, b)
    );
    CREATE INDEX fk_child_payload ON public.fk_child (a) INCLUDE (b);

    -- RLS policy column that is only carried as an INCLUDE payload.
    CREATE TABLE public.rls_payload (id uuid PRIMARY KEY, other_col uuid, policy_col uuid);
    ALTER TABLE public.rls_payload ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_payload_p ON public.rls_payload USING (policy_col = gen_random_uuid());
    CREATE INDEX rls_payload_idx ON public.rls_payload (other_col) INCLUDE (policy_col);

    -- Control: the same shapes, covered by a real key index.
    CREATE TABLE public.fk_ok_parent (a uuid, b uuid, UNIQUE (a, b));
    CREATE TABLE public.fk_ok_child (
      id uuid PRIMARY KEY,
      a  uuid NOT NULL,
      b  uuid NOT NULL,
      CONSTRAINT fk_ok_child_fkey FOREIGN KEY (a, b) REFERENCES public.fk_ok_parent (a, b)
    );
    CREATE INDEX fk_ok_child_key ON public.fk_ok_child (a, b);

    CREATE TABLE public.rls_ok (id uuid PRIMARY KEY, policy_col uuid);
    ALTER TABLE public.rls_ok ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_ok_p ON public.rls_ok USING (policy_col = gen_random_uuid());
    CREATE INDEX rls_ok_key ON public.rls_ok (policy_col);
  `);
}, 180_000);

afterAll(async () => {
  await dbManager?.close();
  await teardown?.();
});

describe('advisor index coverage ignores INCLUDE payload columns', () => {
  it('still flags a foreign key whose column is only an INCLUDE payload', async () => {
    const objects = await scanFor('missing-fk-index');

    // fk_child_payload is ON (a) INCLUDE (b); it cannot satisfy FK (a, b).
    expect(objects).toContain('public.fk_child.fk_child_fkey');
  }, 90_000);

  it('still flags an RLS column that is only an INCLUDE payload', async () => {
    const objects = await scanFor('missing-rls-index');

    // rls_payload_idx is ON (other_col) INCLUDE (policy_col); it cannot filter
    // on policy_col.
    expect(objects).toContain('public.rls_payload.policy_col');
  }, 90_000);

  it('leaves both rules satisfied by a genuine key index', async () => {
    const [fkObjects, rlsObjects] = [
      await scanFor('missing-fk-index'),
      await scanFor('missing-rls-index'),
    ];

    expect(fkObjects).not.toContain('public.fk_ok_child.fk_ok_child_fkey');
    expect(rlsObjects).not.toContain('public.rls_ok.policy_col');
  }, 90_000);

  it('clears the payload cases once a real key index is added', async () => {
    await query(`
      CREATE INDEX fk_child_key ON public.fk_child (a, b);
      CREATE INDEX rls_payload_key ON public.rls_payload (policy_col);
    `);

    expect(await scanFor('missing-fk-index')).not.toContain('public.fk_child.fk_child_fkey');
    expect(await scanFor('missing-rls-index')).not.toContain('public.rls_payload.policy_col');
  }, 90_000);
});
