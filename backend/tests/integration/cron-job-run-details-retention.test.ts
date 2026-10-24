import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PgTestClient } from 'insforge-test';
import { getConnections } from './utils';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationSql = fs.readFileSync(
  path.resolve(
    currentDir,
    '../../src/infra/database/migrations/067_cron-job-run-details-retention.sql'
  ),
  'utf8'
);

let pg: PgTestClient;
let teardown: () => Promise<void>;

// Inserts `count` cron.job_run_details rows. `endedDaysAgo` = null means the
// run is still going (end_time IS NULL).
async function seedRuns(count: number, endedDaysAgo: number | null, status: string) {
  await pg.query(
    `INSERT INTO cron.job_run_details (jobid, command, status, start_time, end_time)
     SELECT 1, 'SELECT 1', $2,
            NOW() - make_interval(days => COALESCE($3::int, 30)) - INTERVAL '1 minute',
            CASE WHEN $3::int IS NULL THEN NULL
                 ELSE NOW() - make_interval(days => $3::int) END
     FROM generate_series(1, $1::int)`,
    [count, status, endedDaysAgo]
  );
}

async function cleanup(batchSize: number | null, maxBatches: number | null): Promise<number> {
  const { rows } = await pg.query(
    `SELECT schedules.cleanup_cron_job_run_details($1::int, $2::int) AS deleted`,
    [batchSize, maxBatches]
  );
  return rows[0].deleted;
}

async function remaining(): Promise<{ finished_recent: number; expired: number; running: number }> {
  const { rows } = await pg.query(
    `SELECT
       COUNT(*) FILTER (WHERE end_time >= NOW() - INTERVAL '7 days')::int AS finished_recent,
       COUNT(*) FILTER (WHERE end_time < NOW() - INTERVAL '7 days')::int AS expired,
       COUNT(*) FILTER (WHERE end_time IS NULL)::int AS running
     FROM cron.job_run_details`
  );
  return rows[0];
}

beforeAll(async () => {
  ({ pg, teardown } = await getConnections());
});

afterAll(() => teardown());

beforeEach(async () => {
  await pg.beforeEach();
  await pg.query(`TRUNCATE cron.job_run_details`);
  await pg.query(`UPDATE schedules.config SET retention_days = 7`);
});

afterEach(() => pg.afterEach());

describe('schedules.cleanup_cron_job_run_details', () => {
  it('deletes only finished runs older than retention, at most batch_size * max_batches per call', async () => {
    // Recent rows get the lowest runids so the expired rows come after them in
    // the runid walk.
    await seedRuns(50, 1, 'succeeded');
    await seedRuns(2500, 30, 'succeeded');
    await seedRuns(3, null, 'running');

    expect(await cleanup(1000, 2)).toBe(2000);
    expect(await remaining()).toEqual({ finished_recent: 50, expired: 500, running: 3 });

    expect(await cleanup(1000, 2)).toBe(500);
    expect(await cleanup(1000, 2)).toBe(0);
    expect(await remaining()).toEqual({ finished_recent: 50, expired: 0, running: 3 });
  });

  it('stops when a batch is not full and deletes expired rows spread across the runid range', async () => {
    await seedRuns(5, 30, 'succeeded');
    await seedRuns(5, 1, 'succeeded');
    await seedRuns(5, 30, 'failed');
    await seedRuns(2, null, 'starting');

    expect(await cleanup(3, 100)).toBe(10);
    expect(await remaining()).toEqual({ finished_recent: 5, expired: 0, running: 2 });
  });

  it('works with the default arguments used by the cron job', async () => {
    await seedRuns(1500, 30, 'succeeded');

    const { rows } = await pg.query(`SELECT schedules.cleanup_cron_job_run_details() AS deleted`);
    expect(rows[0].deleted).toBe(1500);
  });

  it('follows schedules.config.retention_days', async () => {
    await seedRuns(10, 30, 'succeeded');
    await seedRuns(10, 10, 'succeeded');

    await pg.query(`UPDATE schedules.config SET retention_days = 60`);
    expect(await cleanup(1000, 100)).toBe(0);

    await pg.query(`UPDATE schedules.config SET retention_days = 20`);
    expect(await cleanup(1000, 100)).toBe(10);

    await pg.query(`UPDATE schedules.config SET retention_days = 5`);
    expect(await cleanup(1000, 100)).toBe(10);
  });

  it('deletes nothing when retention is disabled', async () => {
    await seedRuns(10, 30, 'succeeded');
    await pg.query(`UPDATE schedules.config SET retention_days = NULL`);

    expect(await cleanup(1000, 100)).toBe(0);
    expect((await remaining()).expired).toBe(10);
  });

  it('returns 0 and deletes nothing on invalid arguments', async () => {
    await seedRuns(10, 30, 'succeeded');

    expect(await cleanup(0, 100)).toBe(0);
    expect(await cleanup(1000, 0)).toBe(0);
    expect(await cleanup(-1, 100)).toBe(0);
    expect(await cleanup(1000, null)).toBe(0);
    expect((await remaining()).expired).toBe(10);
  });

  it('is not executable by API roles', async () => {
    for (const role of ['anon', 'authenticated', 'project_admin']) {
      const { rows } = await pg.query(
        `SELECT has_function_privilege($1, 'schedules.cleanup_cron_job_run_details(int, int)', 'EXECUTE') AS allowed`,
        [role]
      );
      expect(rows[0].allowed).toBe(false);
    }
  });

  it('applies again cleanly on an already migrated database', async () => {
    await seedRuns(10, 30, 'succeeded');

    await pg.query(migrationSql);

    expect(await cleanup(1000, 100)).toBe(10);
  });
});
