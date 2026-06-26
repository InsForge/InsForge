import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/056_drop-deprecated-ai-schema.sql'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('056_drop-deprecated-ai-schema migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('UP drops the ai schema only if it exists, without CASCADE', () => {
    const sql = readMigration();
    const upBlock = sql.split('-- DOWN migration')[0];
    expect(upBlock).toMatch(/IF EXISTS \(SELECT 1 FROM pg_namespace WHERE nspname = 'ai'\)/);
    expect(upBlock).toMatch(/DROP SCHEMA ai;/);
    expect(upBlock).not.toMatch(/CASCADE/);
  });

  it('DOWN recreates the empty ai schema', () => {
    const sql = readMigration();
    const downSection = sql.split('-- DOWN migration')[1];
    expect(downSection).toBeDefined();
    expect(downSection).toMatch(/CREATE SCHEMA IF NOT EXISTS ai;/);
  });

  it('runs after migration 043 which drops the ai tables', () => {
    const migrationsDir = path.join(currentDir, '../../src/infra/database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx043 = files.findIndex((f) => f.startsWith('043_'));
    const idx056 = files.findIndex((f) => f.startsWith('056_drop-deprecated-ai-schema'));

    expect(idx043).toBeGreaterThanOrEqual(0);
    expect(idx056).toBeGreaterThan(idx043);
  });
});
