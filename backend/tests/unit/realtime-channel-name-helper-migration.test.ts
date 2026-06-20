import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '052_fix-realtime-channel-name-helper.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readSql(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('052_fix-realtime-channel-name-helper migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('replaces realtime.channel_name with a blank-to-NULL guard', () => {
    const sql = readSql();

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION realtime\.channel_name\(\)/i);
    expect(sql).toMatch(
      /nullif\(\s*current_setting\(\s*'realtime\.channel_name'\s*,\s*true\s*\)\s*,\s*''\s*\)/i
    );
  });

  it('keeps function execute grants for runtime roles', () => {
    const sql = readSql();

    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+realtime\.channel_name\(\)\s+TO\s+authenticated,\s*anon,\s*project_admin/i
    );
  });

  it('runs after database backups without editing historical migrations', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(
      migrations.indexOf('051_create-database-backups.sql')
    );

    expect(readSql()).not.toMatch(/017_create-realtime-schema/i);
  });
});
