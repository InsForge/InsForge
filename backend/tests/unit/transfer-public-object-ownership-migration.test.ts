import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '046_transfer-public-object-ownership.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('transfer public object ownership migration', () => {
  it('migration file exists and runs after project admin public privilege grants', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationIndex = migrations.indexOf(migrationFile);
    const predecessorIndex = migrations.indexOf('045_project-admin-public-privileges.sql');

    expect(predecessorIndex).not.toBe(-1);
    expect(migrationIndex).not.toBe(-1);
    expect(migrationIndex).toBeGreaterThan(predecessorIndex);
  });

  it('does not directly alter table-owned sequences', () => {
    const sql = readMigration();

    expect(sql).toMatch(/WHEN 'S' THEN 'SEQUENCE'/i);
    expect(sql).toMatch(
      /AND NOT\s*\(\s*c\.relkind\s*=\s*'S'\s+AND EXISTS\s*\(\s*SELECT 1\s+FROM pg_depend d\s+WHERE d\.objid = c\.oid\s+AND d\.deptype IN \('a', 'i'\)\s*\)\s*\)/
    );
  });

  it('does not directly alter table row types', () => {
    const sql = readMigration();

    expect(sql).toMatch(/ALTER TYPE %I\.%I OWNER TO project_admin/i);
    expect(sql).toMatch(/LEFT JOIN pg_class type_class ON type_class\.oid = t\.typrelid/);
    expect(sql).toMatch(/AND \(t\.typrelid = 0 OR type_class\.relkind = 'c'\)/);
  });
});
