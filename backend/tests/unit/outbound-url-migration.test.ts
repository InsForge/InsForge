import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/065_add-outbound-url-guards.sql'
);

describe('outbound URL guard migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('defines an idempotent database URL guard', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.is_safe_url/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.execute_job/i);
    expect(sql).toMatch(/schedules\.is_safe_url\(v_job\.function_url\)/i);
    expect(sql).not.toMatch(/CURLOPT_RESOLVE/i);
    expect(sql).toMatch(/resolved_target JSONB/i);
    expect(sql).toMatch(/resolved_target->>'rawUrl'/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.is_safe_address/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.is_dns_pinned_url/i);
    expect(sql).toMatch(/rawUrl' IS DISTINCT FROM p_function_url/i);
    expect(sql).toMatch(/jsonb_array_length\(COALESCE\(v_resolved_target->'addresses'/i);
    expect(sql).not.toMatch(/allowPrivateNetworks.*allowlistedHost/is);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS schedules_jobs_function_url_safe/i);
    expect(sql).toMatch(/ADD CONSTRAINT schedules_jobs_function_url_safe/i);
  });

  it('rejects credentials and private destination patterns', () => {
    expect(sql).toMatch(/v_authority\s+~\s+'@'/i);
    expect(sql).toMatch(/127\.0\.0\.0\/8/i);
    expect(sql).toMatch(/169\.254\.0\.0\/16/i);
    expect(sql).toMatch(/v_host\s+~\s+'\^\[0-9\]\+\$'/i);
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

  it('does not leave active database jobs for destinations it cannot pin', () => {
    expect(sql).toMatch(/p_is_active AND NOT schedules\.is_dns_pinned_url/i);
    expect(sql).toMatch(/OR NOT schedules\.is_dns_pinned_url\(function_url, resolved_target\)/i);
  });

  it('guards database HTTP execution before calling pgsql-http', () => {
    const guardIndex = sql.indexOf('IF NOT schedules.is_dns_pinned_url(v_job.function_url, v_job.resolved_target)');
    const httpIndex = sql.indexOf('v_http_response := http(v_http_request)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(httpIndex).toBeGreaterThan(guardIndex);
    expect(sql).not.toMatch(/v_resolved_target := v_job\.resolved_target/i);
  });
});
