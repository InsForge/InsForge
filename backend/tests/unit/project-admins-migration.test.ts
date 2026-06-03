import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '049_create-project-admins.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('project admins migration', () => {
  it('migration file exists and runs after database create privilege migration', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('048_project-admin-database-create-privilege.sql')
    );
  });

  it('creates auth.project_admins as the control-plane admin table', () => {
    const sql = readMigration();

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS auth\.project_admins/i);
    expect(sql).toMatch(/id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/i);
    expect(sql).toMatch(/email TEXT NOT NULL UNIQUE/i);
    expect(sql).not.toMatch(/source TEXT/i);
    expect(sql).not.toMatch(/external_subject TEXT/i);
    expect(sql).not.toMatch(/profile JSONB/i);
  });

  it('backfills existing project-admin users before dropping the auth.users flag', () => {
    const sql = readMigration();

    expect(sql).toMatch(/INSERT INTO auth\.project_admins \(id, email, created_at, updated_at\)/i);
    expect(sql).toMatch(/FROM auth\.users\s+WHERE is_project_admin = true/i);
    expect(sql).toMatch(/DELETE FROM auth\.users\s+WHERE is_project_admin = true/i);
    expect(sql).toMatch(/ALTER TABLE auth\.users DROP COLUMN is_project_admin/i);
  });

  it('preserves old admin ids when backfill finds an existing admin email', () => {
    const sql = readMigration();

    expect(sql).toMatch(/ON CONFLICT \(email\) DO UPDATE SET\s+id = EXCLUDED\.id/i);
  });

  it('guards the drop so the migration is idempotent', () => {
    const sql = readMigration();

    expect(sql).toMatch(/information_schema\.columns/i);
    expect(sql).toMatch(/column_name = 'is_project_admin'/i);
  });

  it('grants project_admin access to the new admin table explicitly', () => {
    const sql = readMigration();

    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\)/i);
    expect(sql).toMatch(
      /GRANT SELECT,\s*INSERT,\s*UPDATE,\s*DELETE ON TABLE auth\.project_admins TO project_admin/i
    );
  });
});
