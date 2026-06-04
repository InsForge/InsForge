import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '049_remove-project-admin-users.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('remove project admin users migration', () => {
  it('migration file exists and runs after project admin database grants', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationIndex = migrations.indexOf(migrationFile);
    const predecessorIndex = migrations.indexOf('048_project-admin-database-create-privilege.sql');

    expect(predecessorIndex).not.toBe(-1);
    expect(migrationIndex).not.toBe(-1);
    expect(migrationIndex).toBeGreaterThan(predecessorIndex);
  });

  it('is guarded for fresh databases and repeated execution', () => {
    const sql = readMigration();

    expect(sql).toMatch(/to_regclass\('auth\.project_admins'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/column_name\s+=\s+'is_project_admin'/i);
    expect(sql).toMatch(/IF\s+NOT\s+has_is_project_admin\s+THEN\s+RETURN;/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+auth\.users\s+DROP\s+COLUMN\s+is_project_admin/i);
  });

  it('disables legacy admin rows if restrictive foreign keys prevent deletion', () => {
    const sql = readMigration();

    expect(sql).toMatch(/EXCEPTION\s+WHEN\s+foreign_key_violation/i);
    expect(sql).toMatch(/password\s+=\s+NULL/i);
    expect(sql).toMatch(/email_verified\s+=\s+false/i);
    expect(sql).toMatch(/is_anonymous\s+=\s+true/i);
    expect(sql).toMatch(/deleted-project-admin-/i);
  });
});
