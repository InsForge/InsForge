import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { getConnections } from './utils';

/**
 * The missing-rls-index rule against a real migrated database.
 *
 * The rule has to decide which columns a policy actually filters on. Doing that
 * by matching the column name against the rendered policy expression is both
 * fragile and unsafe: a name carrying regex punctuation errors the query out,
 * which drops every finding of this rule for the whole database, and a name
 * that merely appears inside a string literal produces a finding for a column
 * no policy reads. This suite pins the behaviour for both.
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

interface Finding {
  affectedObject: string;
  recommendation: string;
}

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const result = await dbManager.getPool().query(sql, params);
  return result.rows as T[];
}

/** Runs one scan to completion and returns every missing-rls-index finding. */
async function scanForRlsFindings(): Promise<Finding[]> {
  const scanId = await svc.triggerScan('manual');

  const deadline = Date.now() + 60_000;
  while (svc.isScanInProgress() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (svc.isScanInProgress()) {
    throw new Error('advisor scan did not finish in time');
  }

  return query<Finding>(
    `SELECT affected_object AS "affectedObject", recommendation
       FROM system.advisor_findings
      WHERE scan_id = $1 AND rule_id = 'missing-rls-index'
      ORDER BY affected_object`,
    [scanId]
  );
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
    -- An ordinary RLS table, used to prove the rule still reports at all.
    CREATE TABLE public.notes (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notes_owner ON public.notes USING (owner_id = gen_random_uuid());

    -- A table shaped like a CSV import: one column name carries regex
    -- punctuation, and another shares its name with a string literal.
    CREATE TABLE public.imports (
      id       uuid PRIMARY KEY,
      "Amount (USD" numeric,
      reviewer uuid,
      status   text
    );
    ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;
    CREATE POLICY imports_amount ON public.imports FOR UPDATE USING ("Amount (USD" > 0);
    CREATE POLICY imports_reviewer ON public.imports FOR INSERT
      WITH CHECK (reviewer = gen_random_uuid());
    CREATE POLICY imports_status ON public.imports FOR DELETE USING (id::text = 'status');

    -- A second policy on a column imports_reviewer already covers, to check the
    -- finding is emitted once per column rather than once per policy.
    CREATE POLICY imports_reviewer_read ON public.imports FOR SELECT
      USING (reviewer = gen_random_uuid());

    -- A policy whose subquery reads a column of a different table. Postgres
    -- records that dependency too, and the attnum is only meaningful relative to
    -- the table it came from, so a dependency that is not filtered to the
    -- policy's own table lands on whatever column happens to share that attnum.
    --
    -- The attnums are chosen to make that visible: lookup.tenant is attnum 3,
    -- and attnum 3 on scoped is "unrelated", a column no policy reads.
    CREATE TABLE public.lookup (join_key uuid, filler uuid, tenant uuid);
    CREATE TABLE public.scoped (
      id        uuid PRIMARY KEY,
      lookup_id uuid NOT NULL,
      unrelated uuid
    );
    ALTER TABLE public.scoped ENABLE ROW LEVEL SECURITY;
    CREATE POLICY scoped_via_lookup ON public.scoped USING (
      EXISTS (
        SELECT 1 FROM public.lookup l
         WHERE l.join_key = lookup_id AND l.tenant = gen_random_uuid()
      )
    );
  `);
}, 180_000);

afterAll(async () => {
  await dbManager?.close();
  await teardown?.();
});

describe('advisor missing-rls-index column resolution', () => {
  it('keeps reporting when a policy table has a regex-hostile column name', async () => {
    const findings = await scanForRlsFindings();

    // Embedding "Amount (USD" in a regex raises "parentheses () not balanced",
    // and the rule is wrapped in a per-rule catch, so every finding it would
    // have produced disappears database-wide.
    expect(findings.map((f) => f.affectedObject)).toContain('public.notes.owner_id');
  }, 90_000);

  it('flags a referenced column whose name needs quoting, with runnable SQL', async () => {
    const findings = await scanForRlsFindings();
    const hostile = findings.find((f) => f.affectedObject === 'public.imports.Amount (USD');

    expect(hostile).toBeDefined();
    // An unquoted index name would not parse.
    expect(hostile?.recommendation).toContain('"idx_imports_Amount (USD"');

    await query(hostile!.recommendation.replace('CONCURRENTLY ', ''));

    const after = await scanForRlsFindings();
    expect(after.map((f) => f.affectedObject)).not.toContain('public.imports.Amount (USD');
  }, 90_000);

  it('covers WITH CHECK expressions, not just USING', async () => {
    const findings = await scanForRlsFindings();

    expect(findings.map((f) => f.affectedObject)).toContain('public.imports.reviewer');
  }, 90_000);

  it('does not flag a column that only appears inside a string literal', async () => {
    const findings = await scanForRlsFindings();

    // imports_status filters on id; "status" is just the literal it compares to.
    expect(findings.map((f) => f.affectedObject)).not.toContain('public.imports.status');
  }, 90_000);

  it('reports a column once even when several policies filter on it', async () => {
    const findings = await scanForRlsFindings();
    const forReviewer = findings.filter((f) => f.affectedObject === 'public.imports.reviewer');

    // Two policies read reviewer. A second identical finding would also hand
    // back a CREATE INDEX that fails on the name the first one took.
    expect(forReviewer).toHaveLength(1);
  }, 90_000);

  it('does not report columns a policy only touches through another table', async () => {
    const findings = await scanForRlsFindings();
    const objects = findings.map((f) => f.affectedObject);

    // Without the own-table filter, lookup.tenant's attnum 3 is applied to
    // scoped, producing a finding for "unrelated", which no policy reads.
    expect(objects).not.toContain('public.scoped.unrelated');
    // Nothing is attributed to the other table either.
    expect(objects.filter((o) => o.startsWith('public.lookup.'))).toEqual([]);
    // The column the policy really filters on is still reported.
    expect(objects).toContain('public.scoped.lookup_id');
  }, 90_000);
});
