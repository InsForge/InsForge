import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '045_project-admin-public-privileges.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('project admin public privileges migration', () => {
  it('migration file exists and runs after request jwt claims migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationIndex = migrations.indexOf(migrationFile);
    const predecessorIndex = migrations.indexOf('044_prefer-request-jwt-claims.sql');

    expect(predecessorIndex).not.toBe(-1);
    expect(migrationIndex).not.toBe(-1);
    expect(migrationIndex).toBeGreaterThan(predecessorIndex);
  });

  it('grants project_admin public access and RLS bypass without assuming the role exists', () => {
    const sql = readMigration();

    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\)/i);
    expect(sql).toMatch(/ALTER ROLE project_admin BYPASSRLS/i);
    expect(sql).toMatch(/GRANT ALL ON SCHEMA public TO project_admin/i);
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO project_admin/i);
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO project_admin/i);
    expect(sql).toMatch(/GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO project_admin/i);
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO project_admin/i
    );
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO project_admin/i
    );
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO project_admin/i
    );
  });

  it('grants project_admin read access across storage tables', () => {
    const sql = readMigration();

    expect(sql).toMatch(/GRANT SELECT ON ALL TABLES IN SCHEMA storage TO project_admin/i);
  });

  it('removes the automatic project_admin_policy machinery and existing generated policies', () => {
    const sql = readMigration();

    expect(sql).toMatch(/DROP EVENT TRIGGER IF EXISTS create_policies_on_table_create/i);
    expect(sql).toMatch(/DROP EVENT TRIGGER IF EXISTS create_policies_on_rls_enable/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS system\.create_default_policies\(\) CASCADE/i);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS system\.create_policies_after_rls\(\) CASCADE/i);
    expect(sql).toMatch(/WHERE policyname = 'project_admin_policy'/i);
    expect(sql).toMatch(/AND cmd = 'ALL'/i);
    expect(sql).toMatch(/AND permissive = 'PERMISSIVE'/i);
    expect(sql).toMatch(/AND roles = ARRAY\['project_admin'\]::name\[\]/i);
    expect(sql).toMatch(/AND qual IN \('true', '\(true\)'\)/i);
    expect(sql).toMatch(/AND with_check IN \('true', '\(true\)'\)/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS %I ON %I\.%I/i);
  });
});
