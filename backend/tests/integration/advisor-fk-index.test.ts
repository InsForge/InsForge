import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import { getConnections } from './utils';

/**
 * The missing-fk-index rule against a real migrated database.
 *
 * The rule clears a finding by comparing the constraint's conkey to the leading
 * columns of an index as an array, so the match is order-sensitive. The
 * remediation it prints therefore has to name the FK columns in that same
 * declaration order. This suite pins the whole loop: what the rule recommends,
 * that the other order does not satisfy it, and that the recommended order does.
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

// A composite foreign key declared out of column order: organization_id is
// attnum 2 and resource_id is attnum 3, but the constraint lists resource_id
// first, so conkey is {3,2} while a plain pg_attribute scan yields {2,3}.
const FK_OBJECT = 'public.assignments.assignments_resource_fkey';

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const result = await dbManager.getPool().query(sql, params);
  return result.rows as T[];
}

/** Runs one scan to completion and returns its missing-fk-index finding, if any. */
async function scanForFkFinding(): Promise<{ description: string; recommendation: string } | null> {
  const scanId = await svc.triggerScan('manual');

  const deadline = Date.now() + 60_000;
  while (svc.isScanInProgress() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (svc.isScanInProgress()) {
    throw new Error('advisor scan did not finish in time');
  }

  const rows = await query<{ description: string; recommendation: string }>(
    `SELECT description, recommendation
       FROM system.advisor_findings
      WHERE scan_id = $1 AND rule_id = 'missing-fk-index' AND affected_object = $2`,
    [scanId, FK_OBJECT]
  );
  return rows[0] ?? null;
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
    CREATE TABLE public.resources (
      organization_id uuid NOT NULL,
      resource_id     uuid NOT NULL,
      UNIQUE (resource_id, organization_id)
    );

    CREATE TABLE public.assignments (
      id              uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      resource_id     uuid NOT NULL,
      CONSTRAINT assignments_resource_fkey
        FOREIGN KEY (resource_id, organization_id)
        REFERENCES public.resources (resource_id, organization_id)
    );
  `);
}, 180_000);

afterAll(async () => {
  await dbManager?.close();
  await teardown?.();
});

describe('advisor missing-fk-index column order', () => {
  it('recommends the FK columns in declaration order, not attnum order', async () => {
    const finding = await scanForFkFinding();

    expect(finding).not.toBeNull();
    // attnum order would read "organization_id, resource_id" and name an index
    // that never clears the finding.
    expect(finding?.recommendation).toContain('(resource_id, organization_id)');
    expect(finding?.description).toContain('resource_id, organization_id');
  }, 90_000);

  it('is not satisfied by an index in the opposite column order', async () => {
    await query(`CREATE INDEX assignments_wrong_order
                   ON public.assignments (organization_id, resource_id)`);

    // This is the reported symptom: the index the old remediation named is a
    // perfectly good query index, but it does not cover the constraint.
    expect(await scanForFkFinding()).not.toBeNull();
  }, 90_000);

  it('clears once its own recommendation is followed verbatim', async () => {
    const finding = await scanForFkFinding();
    expect(finding).not.toBeNull();

    // Run exactly what the advisor printed. CONCURRENTLY is dropped only
    // because it cannot run inside the test transaction; the column list, which
    // is what this is about, is used as-is.
    const recommended = finding!.recommendation.replace('CONCURRENTLY ', '');
    await query(recommended);

    expect(await scanForFkFinding()).toBeNull();
  }, 90_000);
});
