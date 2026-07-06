import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/051_create-database-backups.sql'
);

describe('051_create-database-backups migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── Idempotency guards ───────────────────────────────────────────────
  it('creates the table with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS system\.database_backups/i);
  });

  it('creates indexes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_database_backups_name/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_database_backups_status/i);
  });

  it('drops the updated_at trigger before creating it', () => {
    const dropIndex = sql.search(
      /DROP TRIGGER IF EXISTS update_database_backups_updated_at ON system\.database_backups/i
    );
    const createIndex = sql.search(/CREATE TRIGGER update_database_backups_updated_at/i);
    expect(dropIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(dropIndex);
  });

  // ── Structure ────────────────────────────────────────────────────────
  it('constrains status to the supported lifecycle values', () => {
    expect(sql).toMatch(/CHECK \(status IN \('running', 'completed', 'failed'\)\)/i);
  });

  it('constrains trigger_source to manual or scheduled', () => {
    expect(sql).toMatch(/CHECK \(trigger_source IN \('manual', 'scheduled'\)\)/i);
  });

  it('enforces unique backup names only when a name is set', () => {
    expect(sql).toMatch(/ON system\.database_backups\(name\)\s+WHERE name IS NOT NULL/i);
  });

  it('uses the shared system.update_updated_at trigger function', () => {
    expect(sql).toMatch(/EXECUTE FUNCTION system\.update_updated_at\(\)/i);
  });
});
