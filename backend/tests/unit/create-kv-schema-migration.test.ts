import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '058_create-kv-schema.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('create kv schema migration', () => {
  it('exists and is ordered after the prior migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const idx = migrations.indexOf(migrationFile);
    const prev = migrations.indexOf('057_create-database-advisor.sql');
    expect(prev).not.toBe(-1);
    expect(idx).toBeGreaterThan(prev);
  });

  it('creates the kv schema and entries table idempotently', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS kv/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS kv\.entries/i);
    expect(sql).toMatch(/value\s+JSONB NOT NULL/i);
    expect(sql).toMatch(/expires_at\s+TIMESTAMPTZ/i);
  });

  it('constrains visibility to private/authed/public', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /visibility\s+TEXT NOT NULL[\s\S]*CHECK \(visibility IN \('private', 'authed', 'public'\)\)/i
    );
  });

  it('makes (namespace, key) unique per owner via a COALESCE sentinel index', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_kv_entries_owner_ns_key/i);
    expect(sql).toMatch(/COALESCE\(owner_id, '00000000-0000-0000-0000-000000000000'::uuid\)/i);
  });

  it('enables RLS with owner-scoped policies dropped-before-created (idempotent)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/ALTER TABLE kv\.entries ENABLE ROW LEVEL SECURITY/i);
    for (const policy of [
      'kv_entries_select',
      'kv_entries_insert',
      'kv_entries_update',
      'kv_entries_delete',
    ]) {
      const dropIdx = sql.indexOf(`DROP POLICY IF EXISTS ${policy}`);
      const createIdx = sql.indexOf(`CREATE POLICY ${policy}`);
      expect(dropIdx, `${policy} drop`).toBeGreaterThan(-1);
      expect(createIdx, `${policy} create`).toBeGreaterThan(dropIdx);
    }
    expect(sql).toMatch(/owner_id = auth\.uid\(\)/i);
  });

  it('grants writes to authenticated and read-only to anon', () => {
    const sql = readMigration();
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON kv\.entries TO authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON kv\.entries TO anon/i);
  });

  it('is idempotent on the updated_at trigger', () => {
    const sql = readMigration();
    const dropIdx = sql.indexOf('DROP TRIGGER IF EXISTS trg_kv_entries_updated_at');
    const createIdx = sql.indexOf('CREATE TRIGGER trg_kv_entries_updated_at');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(dropIdx);
  });
});
