import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.resolve(migrationDir, '043_drop-deprecated-ai-configs-and-usage.sql');

describe('043_drop-deprecated-ai-configs-and-usage migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('drops current AI config/usage tables idempotently', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/information_schema\.schemata/i);
    expect(sql).toMatch(/schema_name\s*=\s*'ai'/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS ai\.usage\s+CASCADE\s*;/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS ai\.configs\s+CASCADE\s*;/i);
  });

  it('drops usage tables before config tables to satisfy foreign keys', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql.indexOf('ai.usage')).toBeLessThan(sql.indexOf('ai.configs'));
  });

  it('does not drop legacy-looking public tables because they may be user-owned', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).not.toMatch(/DROP TABLE IF EXISTS public\._ai_usage/i);
    expect(sql).not.toMatch(/DROP TABLE IF EXISTS public\._ai_configs/i);
  });

  it('runs after the retention jobs migration', () => {
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx041 = migrations.indexOf('041_consolidate-retention-jobs.sql');
    const idx043 = migrations.indexOf('043_drop-deprecated-ai-configs-and-usage.sql');

    expect(idx041).toBeGreaterThanOrEqual(0);
    expect(idx043).toBeGreaterThan(idx041);
  });
});
