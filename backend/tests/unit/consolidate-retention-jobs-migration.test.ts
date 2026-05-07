import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '041_consolidate-retention-jobs.sql';
const migrationPath = path.resolve(
  currentDir,
  `../../src/infra/database/migrations/${migrationFile}`
);

describe('consolidate retention jobs migration', () => {
  let sql = '';

  beforeAll(() => {
    sql = fs.readFileSync(migrationPath, 'utf8');
  });

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('does not introduce extra system job metadata tables', () => {
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS realtime\.system_jobs/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS schedules\.system_jobs/i);
  });

  // ── schedules config table ────────────────────────────────────────
  it('creates a schedules.config table for retention settings', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS schedules\.config/i);
    expect(sql).toMatch(/retention_days/i);
  });

  it('uses singleton pattern for config table', () => {
    expect(sql).toMatch(/idx_schedules_config_singleton/i);
  });

  // ── cleanup function ──────────────────────────────────────────────
  it('creates a cleanup function that reads from config', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.cleanup_job_logs/i);
    expect(sql).toMatch(/SELECT retention_days INTO v_retention_days/i);
    expect(sql).toMatch(/FROM schedules\.config/i);
  });

  it('handles "Never" retention (NULL config)', () => {
    expect(sql).toMatch(/v_retention_days IS NULL/i);
  });

  it('guards against non-positive retention values', () => {
    expect(sql).toMatch(/v_retention_days <= 0/i);
    expect(sql).toMatch(/p_batch_size IS NULL OR p_batch_size <= 0/i);
  });

  it('deletes in batches to prevent performance impact', () => {
    expect(sql).toMatch(/p_batch_size/i);
    expect(sql).toMatch(/LOOP/i);
    expect(sql).toMatch(/DELETE FROM schedules\.job_logs/i);
    expect(sql).toMatch(/ORDER BY executed_at ASC/i);
    expect(sql).toMatch(/LIMIT p_batch_size/i);
    expect(sql).toMatch(/EXIT WHEN v_deleted_count < p_batch_size/i);
  });

  // ── idempotency ───────────────────────────────────────────────────
  it('unschedules existing cron jobs before re-scheduling both retention jobs', () => {
    expect(sql).toMatch(/cron\.unschedule/i);
    expect(sql).toMatch(/realtime-message-retention/i);
    expect(sql).toMatch(/schedules-job-logs-retention/i);
  });

  it('does not drop or rename anything destructive', () => {
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP SCHEMA/i);
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?RENAME TO/i);
  });

  it('does not add redundant retention_days ALTER TABLE statements', () => {
    expect(sql).not.toMatch(
      /ALTER TABLE schedules\.config ALTER COLUMN retention_days DROP NOT NULL/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE schedules\.config ALTER COLUMN retention_days SET DEFAULT 7/i
    );
  });

  it('contains no top-level transaction control', () => {
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*ROLLBACK\s*;/im);
  });

  // ── schedule configuration ────────────────────────────────────────
  it('schedules a named pg_cron job for realtime message retention', () => {
    expect(sql).toMatch(/PERFORM cron\.schedule\(/i);
    expect(sql).toMatch(/'realtime-message-retention'/);
    expect(sql).toMatch(/'SELECT realtime\.cleanup_messages\(\)'/i);
  });

  it('runs realtime message retention daily at midnight', () => {
    expect(sql).toMatch(/'0 0 \* \* \*'/);
  });

  it('schedules a named pg_cron job for schedules job log retention', () => {
    expect(sql).toMatch(/PERFORM cron\.schedule\(/i);
    expect(sql).toMatch(/'schedules-job-logs-retention'/);
    expect(sql).toMatch(/'SELECT schedules\.cleanup_job_logs\(\)'/i);
  });

  it('runs hourly (every hour at minute 0)', () => {
    expect(sql).toMatch(/'0 \* \* \* \*'/);
  });

  it('calls the cleanup function', () => {
    expect(sql).toMatch(/SELECT schedules\.cleanup_job_logs\(\)/i);
  });

  // ── ordering ─────────────────────────────────────────────────────
  it('runs after migrations 021 and 024', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx041 = migrations.findIndex((f) => f === migrationFile);
    const idx021 = migrations.findIndex((f) => f === '021_create-schedules-schema.sql');
    const idx024 = migrations.findIndex((f) => f === '024_add-realtime-message-retention.sql');
    expect(idx021).toBeGreaterThanOrEqual(0);
    expect(idx024).toBeGreaterThanOrEqual(0);
    expect(idx041).toBeGreaterThan(idx021);
    expect(idx041).toBeGreaterThan(idx024);
  });
});
