import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '048_project-admin-database-create-privilege.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('project admin database create privilege migration', () => {
  it('migration file exists and runs after internal runtime defaults hardening', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationIndex = migrations.indexOf(migrationFile);
    const predecessorIndex = migrations.indexOf('047_harden-internal-runtime-defaults.sql');

    expect(predecessorIndex).not.toBe(-1);
    expect(migrationIndex).not.toBe(-1);
    expect(migrationIndex).toBeGreaterThan(predecessorIndex);
  });

  it('grants database CREATE to project_admin without assuming the role or database name', () => {
    const sql = readMigration();

    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\)/i);
    expect(sql).toMatch(
      /EXECUTE format\('GRANT CREATE ON DATABASE %I TO project_admin', current_database\(\)\)/i
    );
    expect(sql).not.toMatch(/GRANT CREATE ON DATABASE\s+(?!%I)/i);
  });
});
