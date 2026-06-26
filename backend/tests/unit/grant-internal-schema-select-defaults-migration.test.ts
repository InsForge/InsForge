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

// Schemas 055 manages. `system` is deliberately excluded (migration 054 owns its
// default privilege); `ai`/`public` are excluded too.
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

  it('UP backfills SELECT and sets default privileges for every managed schema', () => {
    const sql = readMigration();
    const upBlock = sql.split('-- DOWN migration')[0];

    for (const schema of MANAGED_SCHEMAS) {
      expect(upBlock).toContain(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO project_admin`);
      expect(upBlock).toContain(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO project_admin`
      );
    }
  });

  it('grants schema USAGE on memory so its SELECT grant is usable', () => {
    const sql = readMigration();
    const upBlock = sql.split('-- DOWN migration')[0];
    expect(upBlock).toContain('GRANT USAGE ON SCHEMA memory TO project_admin');
  });

  it('does not touch the system schema (owned by migration 054)', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/SCHEMA system\b/);
  });

  it('does not touch the ai schema (dropped in migration 056) or public', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/SCHEMA ai\b/);
    expect(sql).not.toMatch(/SCHEMA public\b/);
  });

  it('default privileges are role-agnostic (no FOR ROLE) so they apply to the migration runner', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DEFAULT PRIVILEGES FOR ROLE/);
  });

  it('DOWN revokes only the default-privilege rule, leaving table grants intact', () => {
    const sql = readMigration();
    const downSection = sql.split('-- DOWN migration')[1];
    expect(downSection).toBeDefined();

    for (const schema of MANAGED_SCHEMAS) {
      expect(downSection).toContain(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} REVOKE SELECT ON TABLES FROM project_admin`
      );
    }
    // Table-level grants must NOT be revoked on rollback.
    expect(downSection).not.toMatch(/REVOKE SELECT ON ALL TABLES/);
    // system must not be revoked here -- 054 owns it.
    expect(downSection).not.toMatch(/SCHEMA system\b/);
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
