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

    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('045_project-admin-public-privileges.sql')
    );
  });

  it('does not directly alter table-owned sequences', () => {
    const sql = readMigration();

    expect(sql).toMatch(/WHEN 'S' THEN 'SEQUENCE'/i);
    expect(sql).toMatch(/c\.relkind\s*=\s*'S'/i);
    expect(sql).toMatch(/d\.deptype\s+IN\s+\('a',\s*'i'\)/i);
  });

  it('does not directly alter table row types', () => {
    const sql = readMigration();

    expect(sql).toMatch(/ALTER TYPE %I\.%I OWNER TO project_admin/i);
    expect(sql).toMatch(/type_class\.relkind\s*=\s*'c'/i);
  });
});
