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

  it('falls back to 30 days when retention is disabled', async () => {
    await seedRuns(10, 40, 'succeeded');
    await seedRuns(10, 20, 'succeeded');
    await seedRuns(2, null, 'running');
    await pg.query(`UPDATE schedules.config SET retention_days = NULL`);

    expect(await cleanup(1000, 100)).toBe(10);

    const { rows } = await pg.query(
      `SELECT
         COUNT(*) FILTER (WHERE end_time < NOW() - INTERVAL '30 days')::int AS older_than_fallback,
         COUNT(*) FILTER (WHERE end_time >= NOW() - INTERVAL '30 days')::int AS within_fallback,
         COUNT(*) FILTER (WHERE end_time IS NULL)::int AS running
       FROM cron.job_run_details`
    );
    expect(rows[0]).toEqual({ older_than_fallback: 0, within_fallback: 10, running: 2 });
  });

  it('uses retention_days as-is when it is longer than the fallback', async () => {
    await seedRuns(10, 40, 'succeeded');
    await pg.query(`UPDATE schedules.config SET retention_days = 60`);

    expect(await cleanup(1000, 100)).toBe(0);
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

  it('replaces an existing job with the same name or command instead of adding one', async () => {
    // The shared harness stubs cron.schedule/unschedule as no-ops. Inside this
    // test's transaction, make them write cron.job like pg_cron does.
    await pg.query(`
      CREATE OR REPLACE FUNCTION cron.schedule(job_name text, cron_schedule text, command text)
        RETURNS bigint LANGUAGE sql AS $$
          INSERT INTO cron.job (schedule, command, jobname)
          VALUES (cron_schedule, command, job_name)
          RETURNING jobid
        $$;
      CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint)
        RETURNS boolean LANGUAGE sql AS $$
          DELETE FROM cron.job WHERE jobid = job_id RETURNING true
        $$;
    `);
    // A manually created job with the same name (as on a customer instance),
    // an unnamed job with the same command, and an unrelated job.
    await pg.query(`
      INSERT INTO cron.job (schedule, command, jobname) VALUES
        ('17 3 * * *', 'DELETE FROM cron.job_run_details WHERE end_time < NOW() - INTERVAL ''7 days''', 'cron-job-run-details-retention'),
        ('0 * * * *', 'SELECT schedules.cleanup_cron_job_run_details()', NULL),
        ('*/5 * * * *', 'SELECT 1', 'unrelated-job')
    `);

    await pg.query(migrationSql);
    await pg.query(migrationSql);

    const { rows } = await pg.query(
      `SELECT jobname, schedule, command FROM cron.job ORDER BY jobname`
    );
    expect(rows).toEqual([
      {
        jobname: 'cron-job-run-details-retention',
        schedule: '30 * * * *',
        command: 'SELECT schedules.cleanup_cron_job_run_details()',
      },
      { jobname: 'unrelated-job', schedule: '*/5 * * * *', command: 'SELECT 1' },
    ]);
  });

  it('applies again cleanly on an already migrated database', async () => {
    await seedRuns(10, 30, 'succeeded');

    await pg.query(migrationSql);

    expect(await cleanup(1000, 100)).toBe(10);
  });
});
