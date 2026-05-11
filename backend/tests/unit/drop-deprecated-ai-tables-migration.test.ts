import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.resolve(migrationDir, '042_drop-deprecated-ai-configs-and-usage.sql');

describe('042_drop-deprecated-ai-configs-and-usage migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('drops current AI config/usage tables idempotently', () => {
    expect(sql).toMatch(/DROP TABLE IF EXISTS ai\.usage\s*;/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS ai\.configs\s*;/i);
  });

  it('drops usage tables before config tables to satisfy foreign keys', () => {
    expect(sql.indexOf('ai.usage')).toBeLessThan(sql.indexOf('ai.configs'));
  });

  it('does not drop legacy-looking public tables because they may be user-owned', () => {
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS public\._ai_usage/i);
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS public\._ai_configs/i);
  });

  it('runs after the retention jobs migration', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx041 = migrations.indexOf('041_consolidate-retention-jobs.sql');
    const idx042 = migrations.indexOf('042_drop-deprecated-ai-configs-and-usage.sql');

    expect(idx041).toBeGreaterThanOrEqual(0);
    expect(idx042).toBeGreaterThan(idx041);
  });
});
