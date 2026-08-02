import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/063_add-outbound-url-guards.sql'
);

describe('outbound URL guard migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('defines an idempotent database URL guard', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.is_safe_url/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.execute_job/i);
    expect(sql).toMatch(/schedules\.is_safe_url\(v_job\.function_url\)/i);
    expect(sql).toMatch(/CURLOPT_RESOLVE/i);
    expect(sql).toMatch(/resolved_target JSONB/i);
    expect(sql).toMatch(/resolved_target->>'rawUrl'/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.is_safe_address/i);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS schedules_jobs_function_url_safe/i);
    expect(sql).toMatch(/ADD CONSTRAINT schedules_jobs_function_url_safe/i);
  });

  it('rejects credentials and private destination patterns', () => {
    expect(sql).toMatch(/v_authority\s+~\s+'@'/i);
    expect(sql).toMatch(/127\.0\.0\.0\/8/i);
    expect(sql).toMatch(/169\.254\.0\.0\/16/i);
    expect(sql).toMatch(/2130706433|0x/i);
  });

  it('does not introduce top-level transaction control', () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });

  it('cleans legacy jobs before adding the enforced URL constraint', () => {
    const cleanupIndex = sql.indexOf('WHERE NOT schedules.is_safe_url(function_url)');
    const constraintIndex = sql.indexOf('ADD CONSTRAINT schedules_jobs_function_url_safe');
    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(constraintIndex).toBeGreaterThan(cleanupIndex);
  });
});
