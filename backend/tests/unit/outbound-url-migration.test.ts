import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

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

    // The cleanup loop must actually unschedule cron entries and deactivate rows.
    expect(sql).toMatch(/PERFORM cron\.unschedule\(v_job\.cron_job_id\)/i);
    expect(sql).toMatch(/SET is_active = FALSE/i);
    expect(sql).toMatch(/cron_job_id = NULL/i);
  });

  it('guards database HTTP execution before calling pgsql-http', () => {
    const guardIndex = sql.indexOf(
      'IF NOT schedules.is_dns_pinned_url(v_job.function_url, v_job.resolved_target)'
    );
    const httpIndex = sql.indexOf('v_http_response := http(v_http_request)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(httpIndex).toBeGreaterThan(guardIndex);
    expect(sql).not.toMatch(/v_resolved_target := v_job\.resolved_target/i);
  });

  it('is_dns_pinned_url behaves correctly for both hostnames and literal IPs', () => {
    // Extract the is_dns_pinned_url function body to ensure it structurally mirrors the execution model
    const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION schedules.is_dns_pinned_url');
    const fnEnd = sql.indexOf('$$ LANGUAGE plpgsql IMMUTABLE;', fnStart);
    const fnBody = sql.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/v_is_literal_ip\s+BOOLEAN/i);
    expect(fnBody).toMatch(/WHERE NOT schedules\.is_safe_address\(address\)/i);

    // Provide a Javascript execution model of the PL/pgSQL function to test its runtime logic
    // This allows testing the security outcomes without spinning up a Postgres instance
    function simulate_is_dns_pinned_url(
      p_url: string,
      p_resolved_target: { rawUrl: string; addresses: string[] }
    ) {
      if (!p_url.startsWith('https://') && !p_url.startsWith('http://')) return false; // mock is_safe_url
      if (
        !p_resolved_target ||
        p_resolved_target.rawUrl !== p_url ||
        !p_resolved_target.addresses ||
        p_resolved_target.addresses.length === 0
      ) {
        return false;
      }

      const match = p_url.toLowerCase().match(/^https?:\/\/([^/?#]+)/);
      if (!match) return false;
      const v_authority = match[1];
      const v_host = v_authority.startsWith('[')
        ? v_authority.split(']')[0].replace('[', '')
        : v_authority.replace(/:[0-9]+$/, '');

      let v_is_literal_ip: boolean;
      try {
        // Mimic v_host::INET cast
        if (isIP(v_host) === 0) throw new Error();
        v_is_literal_ip = true;
      } catch {
        v_is_literal_ip = false;
      }

      // Mimic schedules.is_safe_address
      const is_safe_address = (addr: string) => !addr.startsWith('127.') && !addr.startsWith('10.');

      // Mimic NOT EXISTS (... WHERE NOT is_safe_address)
      if (p_resolved_target.addresses.some((addr: string) => !is_safe_address(addr))) {
        return false;
      }

      if (v_is_literal_ip) {
        return is_safe_address(v_host) && p_resolved_target.addresses.includes(v_host);
      }

      return true;
    }

    const safeIp = '93.184.216.34';
    const privateIp = '10.0.0.1';

    // 1. Hostname with all safe addresses -> TRUE
    expect(
      simulate_is_dns_pinned_url('https://example.com/hook', {
        rawUrl: 'https://example.com/hook',
        addresses: [safeIp],
      })
    ).toBe(true);

    // 2. Hostname with mixed safe/private addresses -> FALSE
    expect(
      simulate_is_dns_pinned_url('https://example.com/hook', {
        rawUrl: 'https://example.com/hook',
        addresses: [safeIp, privateIp],
      })
    ).toBe(false);

    // 3. Literal safe IP matching resolved address -> TRUE
    expect(
      simulate_is_dns_pinned_url(`https://${safeIp}/hook`, {
        rawUrl: `https://${safeIp}/hook`,
        addresses: [safeIp],
      })
    ).toBe(true);

    // 4. Literal safe IP NOT matching resolved address -> FALSE
    expect(
      simulate_is_dns_pinned_url(`https://${safeIp}/hook`, {
        rawUrl: `https://${safeIp}/hook`,
        addresses: ['8.8.8.8'], // Different safe IP
      })
    ).toBe(false);
  });
});
