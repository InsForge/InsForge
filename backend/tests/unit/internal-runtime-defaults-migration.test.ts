import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '047_harden_internal_runtime_defaults.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('internal runtime defaults migration', () => {
  it('migration file exists and runs after public object ownership transfer', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('046_transfer-public-object-ownership.sql')
    );
  });

  it('removes stale anon and authenticated table grants from internal schemas', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+auth\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+system\s+FROM\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+functions\s+FROM\s+anon,\s*authenticated/i
    );
  });

  it('removes direct runtime-role auth schema and profile grants', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /REVOKE\s+USAGE\s+ON\s+SCHEMA\s+auth\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+SELECT\s+\(id,\s*profile,\s*created_at\)\s+ON\s+auth\.users\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s+\(profile\)\s+ON\s+auth\.users\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).not.toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA\s+auth\s+TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]*?ON\s+auth\.users\s+TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT\s+UPDATE[\s\S]*?ON\s+auth\.users\s+TO\s+authenticated/i);
  });

  it('removes auth.users RLS policies because auth is API-served', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Public can view user profiles"\s+ON\s+auth\.users/i
    );
    expect(sql).toMatch(
      /DROP\s+POLICY\s+IF\s+EXISTS\s+"Users can update own profile"\s+ON\s+auth\.users/i
    );
    expect(sql).toMatch(/ALTER\s+TABLE\s+auth\.users\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('does not change auth helper function grants', () => {
    const sql = readMigration();

    expect(sql).not.toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+auth\./i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+auth\./i);
  });

  it('removes default anonymous storage table access', () => {
    const sql = readMigration();

    expect(sql).toMatch(/REVOKE\s+USAGE\s+ON\s+SCHEMA\s+storage\s+FROM\s+anon/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.objects\s+FROM\s+anon/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.buckets\s+FROM\s+anon/i
    );
    expect(sql).not.toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.objects\s+FROM\s+authenticated/i
    );
  });

  it('turns storage.objects RLS off only for fresh installs without storage policies', () => {
    const sql = readMigration();

    expect(sql).toMatch(/to_regclass\('storage\.objects'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/NOT\s+EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+storage\.buckets\s+LIMIT\s+1\s*\)/i);
    expect(sql).toMatch(/NOT\s+EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_policy/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+storage\.objects\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
