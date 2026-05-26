import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/027_add-redirect-url-whitelist.sql'
);

describe('027_add-redirect-url-whitelist migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── Idempotent rename ────────────────────────────────────────────────
  it('wraps the configs→config rename in a DO block that checks both source and target', () => {
    expect(sql).toMatch(/to_regclass\('auth\.configs'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/to_regclass\('auth\.config'\)\s+IS\s+NULL/i);
  });

  it('does NOT use bare ALTER TABLE ... RENAME (non-idempotent)', () => {
    // The RENAME must only appear inside the DO block, not as a top-level statement.
    // Split on DO $$ boundaries and check that no top-level RENAME exists.
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/ALTER TABLE.*RENAME TO/i);
  });

  // ── Trigger idempotency ──────────────────────────────────────────────
  it('drops old trigger name (update_configs_updated_at) before creating new one', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS update_configs_updated_at ON auth\.config/i);
  });

  it('drops new trigger name before CREATE to handle re-runs', () => {
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS update_config_updated_at ON auth\.config/i);
  });

  it('creates the update_config_updated_at trigger', () => {
    expect(sql).toMatch(/CREATE TRIGGER update_config_updated_at\s+BEFORE UPDATE ON auth\.config/i);
  });

  // ── allowed_redirect_urls column ─────────────────────────────────────
  it('adds allowed_redirect_urls with IF NOT EXISTS', () => {
    expect(sql).toMatch(
      /ADD COLUMN IF NOT EXISTS allowed_redirect_urls TEXT\[\]\s+DEFAULT\s+'\{\}'/i
    );
  });

  // ── sign_in_redirect_to migration is guarded ─────────────────────────
  it('checks sign_in_redirect_to column exists before migrating data', () => {
    expect(sql).toMatch(
      /information_schema\.columns[\s\S]*?column_name\s*=\s*'sign_in_redirect_to'/i
    );
  });

  it('does NOT use a bare ALTER TABLE DROP COLUMN for sign_in_redirect_to', () => {
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/DROP COLUMN.*sign_in_redirect_to/i);
  });

  // ── email_otps redirect_to column ────────────────────────────────────
  it('adds redirect_to column to auth.email_otps with IF NOT EXISTS', () => {
    expect(sql).toMatch(
      /ALTER TABLE auth\.email_otps\s+ADD COLUMN IF NOT EXISTS redirect_to TEXT/i
    );
  });

  // ── Ordering ─────────────────────────────────────────────────────────
  it('runs after migration 026', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx027 = migrations.indexOf('027_add-redirect-url-whitelist.sql');
    const idx026 = migrations.indexOf('026_create-custom-oauth-configs.sql');
    expect(idx026).toBeGreaterThanOrEqual(0);
    expect(idx027).toBeGreaterThan(idx026);
  });
});
