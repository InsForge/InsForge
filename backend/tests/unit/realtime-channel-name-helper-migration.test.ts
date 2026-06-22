import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationFile = '053_fix-realtime-channel-name-helper.sql';
const migrationPath = path.resolve(migrationDir, migrationFile);

function readSql(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('053_fix-realtime-channel-name-helper migration', () => {
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

  it('relies on CREATE OR REPLACE to preserve grants rather than re-issuing them', () => {
    const sql = readSql();

    // CREATE OR REPLACE preserves the existing ACL, so the grants from 017/045
    // carry over. Re-issuing an unguarded GRANT ... TO project_admin would abort
    // the migration wherever that role is absent (045-048 guard it for a reason).
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+realtime\.channel_name/i);
  });

  it('runs after existing migrations without editing historical migrations', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const prerequisite = '052_add-s3-cors-tagging-versioning.sql';
    expect(migrations).toContain(migrationFile);
    expect(migrations).toContain(prerequisite);
    expect(migrations.indexOf(migrationFile)).toBeGreaterThan(migrations.indexOf(prerequisite));

    expect(readSql()).not.toMatch(/017_create-realtime-schema/i);
  });
});
