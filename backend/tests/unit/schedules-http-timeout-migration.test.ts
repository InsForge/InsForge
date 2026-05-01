import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/037_schedules-http-timeout.sql'
);

describe('037_schedules-http-timeout migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── idempotency ─────────────────────────────────────────────────────
  it('uses CREATE OR REPLACE FUNCTION (idempotent re-run)', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION schedules\.execute_job\(p_job_id UUID\)/i);
  });

  it('does not drop or rename anything', () => {
    expect(sql).not.toMatch(/DROP FUNCTION/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/ALTER TABLE[\s\S]*?RENAME TO/i);
  });

  it('contains no top-level transaction control', () => {
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*COMMIT\s*;/im);
    expect(outsideDoBlocks).not.toMatch(/^\s*ROLLBACK\s*;/im);
  });

  // ── HTTP timeouts are configured ─────────────────────────────────────
  it('sets CURLOPT_TIMEOUT_MS to 300000 (5min end-to-end timeout)', () => {
    expect(sql).toMatch(/http_set_curlopt\(\s*'CURLOPT_TIMEOUT_MS'\s*,\s*'300000'\s*\)/i);
  });

  it('sets CURLOPT_CONNECTTIMEOUT_MS to 5000 (5s connect timeout)', () => {
    expect(sql).toMatch(/http_set_curlopt\(\s*'CURLOPT_CONNECTTIMEOUT_MS'\s*,\s*'5000'\s*\)/i);
  });

  it('timeouts are set BEFORE the http() call inside execute_job', () => {
    // The two PERFORM http_set_curlopt calls must appear textually before the
    // line that invokes http(v_http_request).
    const setIdx = sql.search(/http_set_curlopt/i);
    const httpIdx = sql.search(/v_http_response\s*:=\s*http\(/i);
    expect(setIdx).toBeGreaterThan(0);
    expect(httpIdx).toBeGreaterThan(setIdx);
  });

  // ── still uses the existing http extension (not pg_net) ──────────────
  it('does NOT introduce pg_net (we are intentionally staying with sync http)', () => {
    expect(sql).not.toMatch(/pg_net/i);
    expect(sql).not.toMatch(/net\.http_post/i);
    expect(sql).not.toMatch(/net\.http_get/i);
    expect(sql).not.toMatch(/net\._http_response/i);
  });

  it('still calls the http extension synchronously', () => {
    expect(sql).toMatch(/v_http_response\s*:=\s*http\s*\(\s*v_http_request\s*\)/i);
  });

  // ── preserves the existing exception path ────────────────────────────
  it('preserves the EXCEPTION WHEN OTHERS log path with status 500', () => {
    expect(sql).toMatch(/EXCEPTION\s+WHEN OTHERS THEN[\s\S]*?log_job_execution[\s\S]*?500/i);
  });

  // ── ordering ─────────────────────────────────────────────────────────
  it('runs after migration 021 (schedules schema)', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx037 = migrations.findIndex((f) => f === '037_schedules-http-timeout.sql');
    const idx021 = migrations.findIndex((f) => f === '021_create-schedules-schema.sql');
    expect(idx021).toBeGreaterThanOrEqual(0);
    expect(idx037).toBeGreaterThan(idx021);
  });
});
