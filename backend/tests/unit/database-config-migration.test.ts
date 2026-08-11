import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/061_add-database-config.sql'
);

describe('061_add-database-config migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── Idempotency guards ───────────────────────────────────────────────
  it('creates the config table with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS system\.database_config/i);
  });

  it('creates indexes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_database_config_singleton/i);
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_database_backups_trigger_source_created_at/i
    );
  });

  it('drops the updated_at trigger before creating it', () => {
    const dropIndex = sql.search(
      /DROP TRIGGER IF EXISTS update_database_config_updated_at ON system\.database_config/i
    );
    const createIndex = sql.search(/CREATE TRIGGER update_database_config_updated_at/i);
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(dropIndex);
  });

  it('guards the seed insert with WHERE NOT EXISTS', () => {
    expect(sql).toMatch(
      /INSERT INTO system\.database_config[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM system\.database_config\)/i
    );
  });

  // ── Structure ────────────────────────────────────────────────────────
  it('enforces the singleton pattern with a unique expression index', () => {
    expect(sql).toMatch(/ON system\.database_config \(\(1\)\)/i);
  });

  it('namespaces backup settings so future database config can share the table', () => {
    expect(sql).toMatch(/backup_enabled/);
    expect(sql).toMatch(/backup_cron_schedule/);
    expect(sql).toMatch(/backup_retention_days/);
  });

  it('defaults to disabled so upgrades never start backing up silently', () => {
    expect(sql).toMatch(/backup_enabled BOOLEAN NOT NULL DEFAULT FALSE/i);
  });

  it('carries a schedule anchor separate from the trigger-managed updated_at', () => {
    expect(sql).toMatch(/backup_schedule_anchor TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  });

  it('backfills the anchor column on tables created by an earlier revision', () => {
    expect(sql).toMatch(
      /ALTER TABLE system\.database_config\s+ADD COLUMN IF NOT EXISTS backup_schedule_anchor/i
    );
  });

  it('allows NULL retention (keep forever) but rejects non-positive values', () => {
    expect(sql).toMatch(/CHECK \(backup_retention_days IS NULL OR backup_retention_days > 0\)/i);
  });

  it('uses the shared system.update_updated_at trigger function', () => {
    expect(sql).toMatch(/EXECUTE FUNCTION system\.update_updated_at\(\)/i);
  });
});
