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

  // ── config table ──────────────────────────────────────────────────
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

  it('deletes in batches to prevent performance impact', () => {
    expect(sql).toMatch(/p_batch_size/i);
  });

  // ── idempotency ───────────────────────────────────────────────────
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

  // ── schedule configuration ────────────────────────────────────────
  it('schedules a pg_cron job named schedules-job-logs-retention', () => {
    expect(sql).toMatch(/cron\.schedule\(/i);
    expect(sql).toMatch(/'schedules-job-logs-retention'/);
  });

  it('runs hourly (every hour at minute 0)', () => {
    expect(sql).toMatch(/'0 \* \* \* \*'/);
  });

  it('calls the cleanup function', () => {
    expect(sql).toMatch(/SELECT schedules\.cleanup_job_logs\(\)/i);
  });

  // ── ordering ─────────────────────────────────────────────────────
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
