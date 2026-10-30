import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '063_reassign-root-owned-public-objects.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

const servicePath = path.resolve(
  currentDir,
  '../../src/services/database/database-advance.service.ts'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('reassign root-owned public objects migration', () => {
  it('migration file exists and runs after the one-time 046 transfer', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const migrationIndex = migrations.indexOf(migrationFile);
    const predecessorIndex = migrations.indexOf('046_transfer-public-object-ownership.sql');

    expect(predecessorIndex).not.toBe(-1);
    expect(migrationIndex).not.toBe(-1);
    expect(migrationIndex).toBeGreaterThan(predecessorIndex);
  });

  it('defines the reusable sweep function and invokes it once', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION system\.reassign_public_objects_to_project_admin\(\)/
    );
    expect(sql).toMatch(/SELECT system\.reassign_public_objects_to_project_admin\(\);/);
  });

  it('is a no-op when project_admin does not exist', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\) THEN\s+RETURN;/
    );
  });

  it('keeps the 046 guards: skips table-owned sequences and relation row types', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /AND NOT\s*\(\s*c\.relkind\s*=\s*'S'\s+AND EXISTS\s*\(\s*SELECT 1\s+FROM pg_depend d\s+WHERE d\.objid = c\.oid\s+AND d\.deptype IN \('a', 'i'\)\s*\)\s*\)/
    );
    expect(sql).toMatch(/AND \(t\.typrelid = 0 OR type_class\.relkind = 'c'\)/);
  });

  it('never touches extension-owned objects', () => {
    const sql = readMigration();

    const extensionGuards = sql.match(/d\.deptype = 'e'/g) ?? [];
    expect(extensionGuards.length).toBe(3);
  });

  it('backend reassigns ownership after unrestricted DDL', () => {
    const service = fs.readFileSync(servicePath, 'utf8');

    expect(service).toMatch(
      /if \(asRoot\) \{[\s\S]*?system\.reassign_public_objects_to_project_admin\(\)/
    );
  });
});
