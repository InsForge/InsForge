import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '041_job-logs-retention.sql';
const migrationPath = path.resolve(
  currentDir,
  `../../src/infra/database/migrations/${migrationFile}`
);

describe('job-logs-retention migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── idempotency ─────────────────────────────────────────────────────
  it('unschedules any existing cron job before re-scheduling (idempotent)', () => {
    expect(sql).toMatch(/cron\.unschedule/i);
    expect(sql).toMatch(/schedules-job-logs-retention/i);
  });

  it('does not drop or rename anything destructive', () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP SCHEMA/i);
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?RENAME TO/i);
  });

  it('contains no top-level transaction control', () => {
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*ROLLBACK\s*;/im);
  });

  // ── retention configuration ─────────────────────────────────────────
  it('schedules a pg_cron job named schedules-job-logs-retention', () => {
    expect(sql).toMatch(/cron\.schedule\(/i);
    expect(sql).toMatch(/'schedules-job-logs-retention'/);
  });

  it('runs hourly (every hour at minute 0)', () => {
    expect(sql).toMatch(/'0 \* \* \* \*'/);
  });

  it('deletes rows older than 7 days', () => {
    expect(sql).toMatch(/DELETE FROM schedules\.job_logs/i);
    expect(sql).toMatch(/7 days/i);
  });

  it('filters on executed_at column', () => {
    expect(sql).toMatch(/executed_at\s*<\s*now\(\)\s*-\s*interval/i);
  });

  // ── ordering ─────────────────────────────────────────────────────────
  it('runs after migration 021 (schedules schema)', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx041 = migrations.findIndex((f) => f === migrationFile);
    const idx021 = migrations.findIndex((f) => f === '021_create-schedules-schema.sql');
    expect(idx021).toBeGreaterThanOrEqual(0);
    expect(idx041).toBeGreaterThan(idx021);
  });
});
