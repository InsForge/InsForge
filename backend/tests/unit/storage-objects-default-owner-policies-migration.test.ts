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
    const guards = doBlock.split(/CREATE\s/i)[0];

    expect(guards).toMatch(/pg_policy/i);
    expect(guards).not.toMatch(/storage\.buckets/i);
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

  it('lets reads see public-bucket objects through a hoisted definer helper, not a buckets grant', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /storage_objects_owner_select[\s\S]*?OR\s+\(SELECT\s+storage\.public_buckets\(\)\)\s+@>\s+ARRAY\[bucket\]/i
    );
    expect(sql).toMatch(
      /FUNCTION\s+storage\.public_buckets\(\)[\s\S]*?SECURITY\s+DEFINER\s+SET\s+search_path\s+=\s+pg_catalog,\s*pg_temp/i
    );
    expect(sql).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+storage\.public_buckets\(\)\s+FROM\s+PUBLIC/i
    );
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+storage\.public_buckets\(\)\s+TO\s+authenticated/i
    );
  });

  it('creates the helper only after the no-policy guard', () => {
    const sql = readMigration();
    const guardEnd = sql.search(/IF\s+EXISTS\s+\(SELECT\s+1\s+FROM\s+pg_policy[\s\S]*?END\s+IF;/i);
    const helper = sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+storage\.public_buckets/i);

    expect(guardEnd).toBeGreaterThan(-1);
    expect(helper).toBeGreaterThan(guardEnd);
    expect(sql.slice(0, sql.search(/DO\s*\$migration\$/i))).not.toMatch(
      /^\s*(CREATE|GRANT|REVOKE)\b/im
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
