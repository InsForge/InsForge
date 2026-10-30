import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '062_add-oauth-native-client-ids.sql';
const migrationPath = path.resolve(
  currentDirectory,
  `../../src/infra/database/migrations/${migrationFile}`
);

describe('062_add-oauth-native-client-ids migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('adds the native audience allowlist idempotently', () => {
    expect(sql).toMatch(
      /ALTER TABLE auth\.oauth_configs\s+ADD COLUMN IF NOT EXISTS native_client_ids TEXT\[\]/i
    );
    expect(sql).toMatch(/UPDATE auth\.oauth_configs\s+SET native_client_ids = '\{\}'/i);
    expect(sql).toMatch(/ALTER COLUMN native_client_ids SET DEFAULT '\{\}'/i);
    expect(sql).toMatch(/ALTER COLUMN native_client_ids SET NOT NULL/i);
  });

  it('runs after migration 061', () => {
    const migrationDirectory = path.resolve(
      currentDirectory,
      '../../src/infra/database/migrations'
    );
    const migrations = fs
      .readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const index061 = migrations.indexOf('061_add-database-config.sql');
    const index062 = migrations.indexOf(migrationFile);

    expect(index061).toBeGreaterThanOrEqual(0);
    expect(index062).toBeGreaterThan(index061);
  });
});
