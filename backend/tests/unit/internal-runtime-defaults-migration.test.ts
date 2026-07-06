import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '047_harden-internal-runtime-defaults.sql';
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
      /EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_namespace\s+WHERE\s+nspname\s+=\s+'auth'/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+auth\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_namespace\s+WHERE\s+nspname\s+=\s+'system'/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+system\s+FROM\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_namespace\s+WHERE\s+nspname\s+=\s+'functions'/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+functions\s+FROM\s+anon,\s*authenticated/i
    );
  });

  it('removes direct runtime-role auth table and profile grants', () => {
    const sql = readMigration();

    expect(sql).toMatch(/to_regclass\('auth\.users'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(
      /REVOKE\s+SELECT\s+\(id,\s*profile,\s*created_at\)\s+ON\s+auth\.users\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /REVOKE\s+UPDATE\s+\(profile\)\s+ON\s+auth\.users\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i
    );
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
    expect(sql).not.toMatch(/WHERE\s+polrelid\s+=\s+'auth\.users'::regclass/i);
  });

  it('does not change auth helper function grants', () => {
    const sql = readMigration();

    expect(sql).not.toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+auth\./i);
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+auth\./i);
  });

  it('removes default anonymous storage table access', () => {
    const sql = readMigration();

    expect(sql).toMatch(/REVOKE\s+USAGE\s+ON\s+SCHEMA\s+storage\s+FROM\s+anon/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.objects\s+FROM\s+anon/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.buckets\s+FROM\s+anon/i);
    expect(sql).not.toMatch(
      /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+storage\.objects\s+FROM\s+authenticated/i
    );
  });

  it('keeps public schema existing and future data grants for runtime roles', () => {
    const sql = readMigration();

    expect(sql).toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA\s+public\s+TO\s+anon,\s*authenticated/i);
    expect(sql).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /GRANT\s+USAGE,\s*SELECT\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLES\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+GRANT\s+USAGE,\s*SELECT\s+ON\s+SEQUENCES\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+project_admin\s+IN\s+SCHEMA\s+public\s+GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLES\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).toMatch(
      /ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+project_admin\s+IN\s+SCHEMA\s+public\s+GRANT\s+USAGE,\s*SELECT\s+ON\s+SEQUENCES\s+TO\s+anon,\s*authenticated/i
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:REFERENCES|TRIGGER|TRUNCATE)[\s\S]*?TO\s+anon,\s*authenticated/i
    );
    expect(sql).not.toMatch(/CREATE\s+EVENT\s+TRIGGER/i);
    expect(sql).not.toMatch(/RETURNS\s+event_trigger/i);
    expect(sql).not.toMatch(
      /REVOKE[\s\S]*?(?:ON\s+SCHEMA\s+public|IN\s+SCHEMA\s+public)[\s\S]*?FROM\s+anon/i
    );
    expect(sql).not.toMatch(
      /REVOKE[\s\S]*?(?:ON\s+SCHEMA\s+public|IN\s+SCHEMA\s+public)[\s\S]*?FROM\s+authenticated/i
    );
  });

  it('turns storage.objects RLS off only for fresh installs without storage policies', () => {
    const sql = readMigration();

    expect(sql).toMatch(/to_regclass\('storage\.objects'\)\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/to_regclass\('storage\.buckets'\)\s+IS\s+NULL/i);
    expect(sql).toMatch(
      /ELSIF\s+NOT\s+EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+storage\.buckets\s+LIMIT\s+1\s*\)/i
    );
    expect(sql).toMatch(/NOT\s+EXISTS\s+\(\s*SELECT\s+1\s+FROM\s+pg_policy/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+storage\.objects\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
