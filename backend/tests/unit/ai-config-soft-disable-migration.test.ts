import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('AI config soft-disable migration', () => {
  it('adds ai.configs.is_active with default true and non-null constraint', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationPath = path.resolve(
      currentDir,
      '../../src/infra/database/migrations/023_ai-configs-soft-delete.sql'
    );

    expect(fs.existsSync(migrationPath), `Migration file not found at: ${migrationPath}`).toBe(
      true
    );

    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/\bBEGIN\b\s*;/i);
    expect(sql).toMatch(
      /ALTER TABLE\s+ai\.configs\s+ADD COLUMN\s+is_active\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i
    );
    expect(sql).not.toMatch(/IF\s+NOT\s+EXISTS/i);
    expect(sql).not.toMatch(/UPDATE\s+ai\.configs\s+SET\s+is_active/i);
    expect(sql).not.toMatch(
      /ALTER TABLE\s+ai\.configs\s+ALTER COLUMN\s+is_active\s+SET\s+NOT\s+NULL/i
    );
    expect(sql).not.toMatch(/ON DELETE SET NULL/i);
    expect(sql).not.toMatch(
      /ALTER TABLE\s+ai\.usage\s+ALTER COLUMN\s+config_id\s+DROP\s+NOT\s+NULL/i
    );
    expect(sql).not.toMatch(/DROP CONSTRAINT\s+IF EXISTS\s+usage_config_id_fkey/i);
    expect(sql).toMatch(/\bCOMMIT\b\s*;/i);

    const addColumnPos = sql.search(
      /ADD COLUMN\s+is_active\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+TRUE/i
    );

    expect(
      addColumnPos,
      'ADD COLUMN is_active NOT NULL DEFAULT TRUE pattern not found in migration SQL'
    ).toBeGreaterThanOrEqual(0);
  });

  it('uses migration number 023 for ordering consistency', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationName = '023_ai-configs-soft-delete.sql';
    expect(migrations).toContain(migrationName);

    const migrationIndex = migrations.indexOf(migrationName);
    const previousMigrationIndex = migrations.indexOf('022_create-function-deployments.sql');
    expect(
      previousMigrationIndex,
      '022_create-function-deployments.sql not found in migrations directory'
    ).toBeGreaterThanOrEqual(0);
    expect(migrationIndex).toBeGreaterThan(previousMigrationIndex);
  });

  it('does not change ai.usage foreign key behavior', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationPath = path.resolve(
      currentDir,
      '../../src/infra/database/migrations/023_ai-configs-soft-delete.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).not.toMatch(/ALTER TABLE\s+ai\.usage/i);
    expect(sql).not.toMatch(/usage_config_id_fkey/i);
    expect(sql).not.toMatch(/ALTER COLUMN\s+config_id\s+DROP\s+NOT\s+NULL/i);
    expect(sql).not.toMatch(/ON DELETE SET NULL/i);
  });
});
