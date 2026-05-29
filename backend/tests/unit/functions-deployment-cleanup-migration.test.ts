import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '047_create-functions-deployment-cleanup.sql';
const migrationPath = path.resolve(
  currentDir,
  `../../src/infra/database/migrations/${migrationFile}`
);

describe('functions deployment cleanup migration', () => {
  let sql = '';

  beforeAll(() => {
    sql = fs.readFileSync(migrationPath, 'utf8');
  });

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── indexes ─────────────────────────────────────────────────
  it('adds a composite index on status and created_at', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_functions_deployments_status_created/i);
    expect(sql).toMatch(/ON functions\.deployments\(status,\s*created_at\)/i);
  });

  it('adds a GIN index on functions JSONB column', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_functions_deployments_functions_gin/i
    );
    expect(sql).toMatch(/ON functions\.deployments USING GIN\s*\(functions\)/i);
  });

  // ── join table ──────────────────────────────────────────────
  it('creates deployment_functions join table', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS functions\.deployment_functions/i
    );
  });

  it('join table has deployment_id FK with CASCADE', () => {
    expect(sql).toMatch(
      /deployment_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+functions\.deployments\(id\)\s+ON\s+DELETE\s+CASCADE/i
    );
  });

  it('join table has slug FK with CASCADE', () => {
    expect(sql).toMatch(
      /slug\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+functions\.definitions\(slug\)\s+ON\s+DELETE\s+CASCADE/i
    );
  });

  it('join table has composite primary key', () => {
    expect(sql).toMatch(/PRIMARY\s+KEY\s*\(deployment_id,\s*slug\)/i);
  });

  it('indexes the join table on slug', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_deployment_functions_slug/i
    );
    expect(sql).toMatch(/ON functions\.deployment_functions\(slug\)/i);
  });

  // ── backfill ────────────────────────────────────────────────
  it('backfills existing data from the JSONB array', () => {
    expect(sql).toMatch(/INSERT INTO functions\.deployment_functions/i);
    expect(sql).toMatch(/SELECT.*jsonb_array_elements_text\(d\.functions\)/i);
    expect(sql).toMatch(/FROM functions\.deployments d/i);
  });

  it('backfill filters out NULL and empty arrays', () => {
    expect(sql).toMatch(/WHERE d\.functions IS NOT NULL/i);
    expect(sql).toMatch(/AND jsonb_array_length\(d\.functions\) > 0/i);
  });

  it('backfill uses ON CONFLICT DO NOTHING', () => {
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/i);
  });

  // ── no cron / no trigger ────────────────────────────────────
  it('does not create a cron cleanup function', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION.*cleanup/i);
  });

  it('does not schedule a pg_cron job', () => {
    expect(sql).not.toMatch(/cron\.schedule/i);
    expect(sql).not.toMatch(/cron\.job/i);
    expect(sql).not.toMatch(/cron\.unschedule/i);
  });

  it('does not create a trigger', () => {
    expect(sql).not.toMatch(/CREATE TRIGGER/i);
  });

  it('does not use SECURITY DEFINER', () => {
    expect(sql).not.toMatch(/SECURITY DEFINER/i);
  });

  // ── ordering ────────────────────────────────────────────────
  it('runs after migration 022 (functions.deployments table)', () => {
    const migrationDir = path.resolve(
      currentDir,
      '../../src/infra/database/migrations'
    );
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx047 = migrations.findIndex((f) => f === migrationFile);
    const idx022 = migrations.findIndex((f) => f === '022_create-function-deployments.sql');
    expect(idx022).toBeGreaterThanOrEqual(0);
    expect(idx047).toBeGreaterThan(idx022);
  });
});
