import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/036_storage-third-party-auth-support.sql'
);

describe('036_storage-third-party-auth-support migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  // ── FK drop is idempotent ────────────────────────────────────────────
  it('drops the uploaded_by FK with IF EXISTS', () => {
    expect(sql).toMatch(
      /ALTER TABLE storage\.objects\s+DROP CONSTRAINT IF EXISTS objects_uploaded_by_fkey/i
    );
  });

  // ── Column widen is idempotent ───────────────────────────────────────
  it('guards ALTER COLUMN uploaded_by TYPE TEXT behind information_schema check', () => {
    // Once policies reference uploaded_by, Postgres rejects ALTER TYPE.
    expect(sql).toMatch(
      /information_schema\.columns[\s\S]*?column_name\s*=\s*'uploaded_by'[\s\S]*?<>\s*'text'[\s\S]*?ALTER COLUMN uploaded_by TYPE TEXT/i
    );
  });

  it('does NOT have a bare ALTER COLUMN uploaded_by TYPE TEXT outside a DO block', () => {
    // Strip DO $tag$ ... $tag$ blocks (matched dollar-quoted tags so we
    // don't stop at nested $sql$ ... $sql$ inside).
    const outsideDoBlocks = sql.replace(/DO\s*\$(\w+)\$[\s\S]*?\$\1\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/ALTER COLUMN uploaded_by TYPE TEXT/i);
  });

  // ── Path helpers use CREATE OR REPLACE ───────────────────────────────
  it('defines storage.foldername with CREATE OR REPLACE (replay-safe)', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION storage\.foldername/i);
  });

  it('defines storage.filename with CREATE OR REPLACE', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION storage\.filename/i);
  });

  it('defines storage.extension with CREATE OR REPLACE', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION storage\.extension/i);
  });

  // ── auth.jwt() helper ────────────────────────────────────────────────
  it('defines auth.jwt() with CREATE OR REPLACE', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION auth\.jwt\(\)/i);
  });

  it('auth.jwt() reads request.jwt.claims (the GUC withUserContext sets)', () => {
    expect(sql).toMatch(/current_setting\(\s*'request\.jwt\.claims'\s*,\s*true\s*\)/i);
  });

  it('auth.jwt() does NOT read the never-set request.jwt.claim singular form', () => {
    // withUserContext only sets request.jwt.claims (jsonb) and dotted forms.
    expect(sql).not.toMatch(/current_setting\(\s*'request\.jwt\.claim'\s*,/i);
  });

  // ── RLS enablement ───────────────────────────────────────────────────
  it('enables RLS on storage.objects', () => {
    expect(sql).toMatch(/ALTER TABLE storage\.objects ENABLE ROW LEVEL SECURITY/i);
  });

  // ── Policy install is idempotent and gated on existing projects ──────
  it('gates policy install on existing buckets (fresh installs ship deny-by-default)', () => {
    expect(sql).toMatch(/IF EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+storage\.buckets/i);
  });

  // Postgres has no CREATE POLICY IF NOT EXISTS through PG17 — each CREATE
  // must be wrapped in a pg_policy lookup to stay replay-safe.
  it.each([
    'storage_objects_owner_select',
    'storage_objects_owner_insert',
    'storage_objects_owner_update',
    'storage_objects_owner_delete',
  ])('guards CREATE POLICY %s with a pg_policy NOT EXISTS check', (polname) => {
    const guardedRegex = new RegExp(
      `IF NOT EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+pg_policy[\\s\\S]*?polname\\s*=\\s*'${polname}'[\\s\\S]*?CREATE POLICY ${polname}`,
      'i'
    );
    expect(sql).toMatch(guardedRegex);
  });

  it('does NOT have a bare CREATE POLICY outside the guarded DO block', () => {
    // Strip dollar-quoted DO blocks (matched tags so $sql$ inside doesn't
    // close $migration$ early) and -- line comments before the assertion.
    const stripped = sql.replace(/DO\s*\$(\w+)\$[\s\S]*?\$\1\$/g, '').replace(/^\s*--.*$/gm, '');
    expect(stripped).not.toMatch(/CREATE POLICY/i);
  });

  it("uses (SELECT auth.jwt() ->> 'sub') hoisted form (cached once per query)", () => {
    const matches = sql.match(/\(\s*SELECT\s+auth\.jwt\(\)\s*->>\s*'sub'\s*\)/gi);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  // ── Grants ───────────────────────────────────────────────────────────
  it('grants storage.objects DML to authenticated', () => {
    expect(sql).toMatch(
      /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+storage\.objects\s+TO\s+authenticated/i
    );
  });

  it('grants USAGE on schema storage to authenticated', () => {
    expect(sql).toMatch(/GRANT\s+USAGE\s+ON\s+SCHEMA\s+storage\s+TO\s+authenticated/i);
  });

  it('grants EXECUTE on auth.jwt() to authenticated and anon', () => {
    expect(sql).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+auth\.jwt\(\)\s+TO\s+authenticated,\s*anon/i
    );
  });

  // ── Ordering ─────────────────────────────────────────────────────────
  it('runs after migration 035', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx036 = migrations.indexOf('036_storage-third-party-auth-support.sql');
    expect(idx036).toBeGreaterThanOrEqual(0);
    const earlierMigrations = migrations.filter((m) => m.startsWith('035_'));
    if (earlierMigrations.length > 0) {
      const idx035 = migrations.indexOf(earlierMigrations[0]);
      expect(idx036).toBeGreaterThan(idx035);
    }
  });
});
