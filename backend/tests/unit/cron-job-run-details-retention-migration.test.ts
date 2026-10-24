import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '067_cron-job-run-details-retention.sql';
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.join(migrationDir, migrationFile);

describe('cron-job-run-details-retention migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('defines the cleanup function idempotently', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.cleanup_cron_job_run_details\(/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION schedules\.cleanup_cron_job_run_details\(INT, INT\) FROM PUBLIC/i
    );
  });

  it('reuses schedules.config.retention_days', () => {
    expect(sql).toMatch(/SELECT retention_days INTO v_retention_days\s+FROM schedules\.config/i);
  });

  it('falls back to a 30-day floor when retention is disabled', () => {
    expect(sql).toMatch(
      /IF v_retention_days IS NULL OR v_retention_days <= 0 THEN\s+v_retention_days := 30;/i
    );
  });

  it('deletes cron.job_run_details in bounded batches', () => {
    expect(sql).toMatch(/p_batch_size INT DEFAULT 1000/i);
    expect(sql).toMatch(/p_max_batches INT DEFAULT 100/i);
    expect(sql).toMatch(/DELETE FROM cron\.job_run_details/i);
    expect(sql).toMatch(/LIMIT p_batch_size/i);
    expect(sql).toMatch(/v_batches >= p_max_batches/i);
  });

  it('only deletes finished runs older than the cutoff', () => {
    // end_time < cutoff is never true for running jobs (end_time IS NULL).
    expect(sql).toMatch(/end_time < v_cutoff/i);
    expect(sql).not.toMatch(/start_time < v_cutoff/i);
  });

  it('replaces any existing job with the same name or command before scheduling', () => {
    const doBlock = sql.slice(sql.search(/DO \$\$/));
    expect(doBlock).toMatch(/jobname = 'cron-job-run-details-retention'/);
    expect(doBlock).toMatch(/command = 'SELECT schedules\.cleanup_cron_job_run_details\(\)'/);
    const unscheduleIdx = doBlock.search(/cron\.unschedule\(/);
    const scheduleIdx = doBlock.search(/cron\.schedule\(/);
    expect(unscheduleIdx).toBeGreaterThan(0);
    expect(scheduleIdx).toBeGreaterThan(unscheduleIdx);
  });

  it('schedules the cleanup hourly', () => {
    expect(sql).toMatch(
      /cron\.schedule\(\s*'cron-job-run-details-retention',\s*'30 \* \* \* \*',\s*'SELECT schedules\.cleanup_cron_job_run_details\(\)'\s*\)/
    );
  });

  it('contains no top-level transaction control', () => {
    const outside = sql.replace(/\$\$[\s\S]*?\$\$/g, '');
    expect(outside).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(outside).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(outside).not.toMatch(/^\s*ROLLBACK\s*;/im);
  });

  it('runs after migration 041 (schedules.config)', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx041 = migrations.indexOf('041_consolidate-retention-jobs.sql');
    expect(idx041).toBeGreaterThanOrEqual(0);
    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(idx041);
  });
});
