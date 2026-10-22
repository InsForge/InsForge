import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '066_storage-objects-default-owner-policies.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('storage.objects default owner policies migration', () => {
  it('runs after 047, which disables RLS on policy-less fresh installs', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('047_harden-internal-runtime-defaults.sql')
    );
  });

  it('only acts when storage.objects has no policy at all', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /IF\s+EXISTS\s+\(SELECT\s+1\s+FROM\s+pg_policy\s+WHERE\s+polrelid\s+=\s+'storage\.objects'::regclass\)\s+THEN\s+RETURN;/i
    );
  });

  it('does not depend on a bucket existing', () => {
    const doBlock = readMigration().match(/DO\s*\$migration\$[\s\S]*?\$migration\$/i)?.[0] ?? '';

    expect(doBlock).not.toMatch(/FROM\s+storage\.buckets/i);
  });

  it('keeps every write owner-only', () => {
    const sql = readMigration();
    const owner = String.raw`uploaded_by\s+=\s+\(SELECT\s+auth\.jwt\(\)\s+->>\s+'sub'\)`;

    expect(sql).toMatch(
      new RegExp(
        String.raw`storage_objects_owner_insert[\s\S]*?FOR\s+INSERT\s+TO\s+authenticated\s+WITH\s+CHECK\s+\(${owner}\);`,
        'i'
      )
    );
    expect(sql).toMatch(
      new RegExp(
        String.raw`storage_objects_owner_update[\s\S]*?FOR\s+UPDATE\s+TO\s+authenticated\s+USING\s+\(${owner}\)\s+WITH\s+CHECK\s+\(${owner}\);`,
        'i'
      )
    );
    expect(sql).toMatch(
      new RegExp(
        String.raw`storage_objects_owner_delete[\s\S]*?FOR\s+DELETE\s+TO\s+authenticated\s+USING\s+\(${owner}\);`,
        'i'
      )
    );
  });

  it('lets reads see public-bucket objects through a definer helper, not a buckets grant', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /storage_objects_owner_select[\s\S]*?OR\s+storage\.bucket_is_public\(bucket\)/i
    );
    expect(sql).toMatch(
      /FUNCTION\s+storage\.bucket_is_public\(bucket_name\s+text\)[\s\S]*?SECURITY\s+DEFINER/i
    );
    expect(sql).toMatch(/SET\s+search_path\s+=\s+pg_catalog,\s*pg_temp/i);
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+storage\.bucket_is_public\(text\)\s+FROM\s+PUBLIC/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+storage\.bucket_is_public\(text\)\s+TO\s+authenticated/i
    );
  });

  it('enables RLS after the policies exist', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /CREATE\s+POLICY\s+storage_objects_owner_delete[\s\S]*?ALTER\s+TABLE\s+storage\.objects\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});
