import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '058_grant-anon-storage-access.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

// Executable SQL only, with `--` comments stripped. Assertions about what the
// migration does (and does not do) must not trip over the explanatory header.
function readMigrationSql(): string {
  return readMigration()
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

describe('grant anon storage access migration', () => {
  it('migration file exists and runs after the anon storage revoke', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    // Must land after 047, which revoked anon's storage access; otherwise the
    // revoke would win and anon would still be locked out.
    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('047_harden-internal-runtime-defaults.sql')
    );
  });

  it('grants schema USAGE and object DML to anon', () => {
    const sql = readMigrationSql();

    expect(sql).toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA\s+storage\s+TO\s+anon/i);
    expect(sql).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+storage\.objects\s+TO\s+anon/i
    );
  });

  it('is guarded on the anon role and storage schema existing', () => {
    const sql = readMigrationSql();

    expect(sql).toMatch(/EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_roles\s+WHERE\s+rolname\s+=\s+'anon'/i);
    expect(sql).toMatch(/to_regnamespace\('storage'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/to_regclass\('storage\.objects'\)\s+IS\s+NOT\s+NULL/i);
  });

  it('does not touch RLS enablement or create any policy', () => {
    const sql = readMigrationSql();

    expect(sql).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/DROP\s+POLICY/i);
  });

  it('does not grant anon any privileges on buckets and does not revoke anything', () => {
    const sql = readMigrationSql();

    expect(sql).not.toMatch(/storage\.buckets/i);
    expect(sql).not.toMatch(/REVOKE/i);
  });
});
