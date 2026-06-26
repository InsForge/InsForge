import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/055_grant-internal-schema-select-defaults.sql'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

// Schemas 055 manages. `system` is excluded (migration 054 owns its default
// privilege); `ai` is dropped here; `public` is excluded too.
const MANAGED_SCHEMAS = [
  'auth',
  'compute',
  'deployments',
  'email',
  'functions',
  'memory',
  'payments',
  'realtime',
  'schedules',
  'storage',
];

describe('055_grant-internal-schema-select-defaults migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('backfills SELECT and sets default privileges for every managed schema', () => {
    const sql = readMigration();
    for (const schema of MANAGED_SCHEMAS) {
      expect(sql).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO project_admin`);
      expect(sql).toContain(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO project_admin`
      );
    }
  });

  it('grants schema USAGE on memory so its SELECT grant is usable', () => {
    const sql = readMigration();
    expect(sql).toContain('GRANT USAGE ON SCHEMA memory TO project_admin');
  });

  it('does not touch the system schema (owned by migration 054) or public', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/SCHEMA system\b/);
    expect(sql).not.toMatch(/SCHEMA public\b/);
  });

  it('guards the role and every schema so a missing object is a no-op, not an error', () => {
    const sql = readMigration();
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\)/);
    for (const schema of MANAGED_SCHEMAS) {
      expect(sql).toMatch(new RegExp(`IF to_regnamespace\\('${schema}'\\) IS NOT NULL THEN`));
    }
  });

  it('drops the deprecated ai schema safely (guarded, no CASCADE, no data loss)', () => {
    const sql = readMigration();
    expect(sql).toMatch(/IF to_regnamespace\('ai'\) IS NOT NULL THEN/);
    expect(sql).toMatch(/DROP SCHEMA ai/);
    expect(sql).not.toMatch(/DROP SCHEMA ai CASCADE/);
    // A non-empty schema is left in place rather than erroring or cascading.
    expect(sql).toMatch(/EXCEPTION WHEN dependent_objects_still_exist/);
    // No SELECT/default grants for ai -- it is being removed.
    expect(sql).not.toMatch(/ON ALL TABLES IN SCHEMA ai\b/);
  });

  it('default privileges are role-agnostic (no FOR ROLE) so they apply to the migration runner', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DEFAULT PRIVILEGES FOR ROLE/);
  });

  it('is forward-only with no down migration', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/--\s*down migration/i);
    expect(sql).not.toMatch(/REVOKE/i);
  });

  it('runs after migrations 045 (creates project_admin) and 050 (creates memory)', () => {
    const migrationsDir = path.join(currentDir, '../../src/infra/database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx045 = files.findIndex((f) => f.startsWith('045_'));
    const idx050 = files.findIndex((f) => f.startsWith('050_'));
    const idx055 = files.findIndex((f) =>
      f.startsWith('055_grant-internal-schema-select-defaults')
    );

    expect(idx045).toBeGreaterThanOrEqual(0);
    expect(idx050).toBeGreaterThanOrEqual(0);
    expect(idx055).toBeGreaterThan(idx045);
    expect(idx055).toBeGreaterThan(idx050);
  });
});
