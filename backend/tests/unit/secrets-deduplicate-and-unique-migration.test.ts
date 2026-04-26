import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/035_fix-secrets-deduplicate-and-unique.sql'
);

describe('035_fix-secrets-deduplicate-and-unique migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('runs after migration 034', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx035 = migrations.indexOf('035_fix-secrets-deduplicate-and-unique.sql');
    const idx034 = migrations.indexOf('034_extend-storage-objects-for-s3-protocol.sql');
    expect(idx034).toBeGreaterThanOrEqual(0);
    expect(idx035).toBeGreaterThan(idx034);
  });

  it('targets the system.secrets table', () => {
    expect(sql).toMatch(/system\.secrets/);
    // Make sure we're not accidentally touching some other secrets table
    expect(sql).not.toMatch(/public\.secrets|auth\.secrets/);
  });

  // ── Step 1: Dedupe ────────────────────────────────────────────────────
  it('wraps the dedupe step in a DO block for idempotency', () => {
    expect(sql).toMatch(/DO\s*\$\$[\s\S]*?FOR\s+\w+\s+IN[\s\S]*?LOOP[\s\S]*?END\s+LOOP[\s\S]*?\$\$/i);
  });

  it('only collapses keys that have more than one row', () => {
    expect(sql).toMatch(/GROUP BY key\s+HAVING\s+count\(\*\)\s*>\s*1/i);
  });

  it('skips API_KEY_OLD_* rows so rotation history is preserved', () => {
    expect(sql).toMatch(/key\s+NOT LIKE\s+'API_KEY_OLD_%'/i);
  });

  it('keeps the most recently created row as the survivor', () => {
    // The exclusion subquery picks newest-by-created_at as the row to keep.
    expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC\s+LIMIT\s+1/i);
  });

  it('renames duplicates with a _DUP_<id> suffix to keep them globally unique', () => {
    // The renamed key embeds the row's UUID, so even without UNIQUE(key)
    // already enforced, two rename targets cannot collide.
    expect(sql).toMatch(/key\s*=\s*key\s*\|\|\s*'_DUP_'\s*\|\|\s*id::text/i);
  });

  it('marks renamed duplicates as inactive', () => {
    expect(sql).toMatch(/is_active\s*=\s*false/i);
  });

  it('expires renamed duplicates immediately so read paths skip them', () => {
    // Reads filter `expires_at IS NULL OR expires_at > NOW()`, so setting
    // expires_at = NOW() makes the orphan invisible to validation.
    expect(sql).toMatch(/expires_at\s*=\s*NOW\(\)/i);
  });

  // ── Step 2: UNIQUE(key) constraint ────────────────────────────────────
  it('wraps the constraint add in a DO block for idempotency', () => {
    // The constraint add must be inside a DO block (so it can branch on
    // existence checks), not a bare ALTER TABLE that would error on re-run.
    const lines = sql.split('\n');
    const alterLine = lines.find((l) => /ALTER TABLE.*ADD CONSTRAINT/i.test(l));
    expect(alterLine).toBeDefined();

    // Confirm the ALTER lives inside a DO block, not at top-level.
    const doBlocks = sql.match(/DO\s*\$\$[\s\S]*?\$\$/g) ?? [];
    const inAnyDoBlock = doBlocks.some((block) => /ALTER TABLE.*ADD CONSTRAINT/i.test(block));
    expect(inAnyDoBlock).toBe(true);
  });

  it('skips constraint add if an equivalent unique constraint already exists', () => {
    // Looks at pg_constraint for a UNIQUE constraint on the (key) column.
    expect(sql).toMatch(/pg_constraint[\s\S]*?contype\s*=\s*'u'/i);
    expect(sql).toMatch(/'key'/);
  });

  it('skips constraint add if a unique index on (key) already exists', () => {
    // Some installs may have a unique index without a named constraint
    // (e.g., from Postgres auto-generation on UNIQUE column declarations).
    expect(sql).toMatch(/pg_index[\s\S]*?indisunique/i);
  });

  it('adds the constraint with a descriptive name', () => {
    expect(sql).toMatch(/CONSTRAINT\s+secrets_key_unique\s+UNIQUE\s*\(\s*key\s*\)/i);
  });

  it('does NOT use a bare top-level ALTER TABLE ADD CONSTRAINT (non-idempotent)', () => {
    const outsideDoBlocks = sql.replace(/DO\s*\$\$[\s\S]*?\$\$/g, '');
    expect(outsideDoBlocks).not.toMatch(/ALTER TABLE.*ADD CONSTRAINT/i);
  });

  // ── Safety: no destructive operations ─────────────────────────────────
  it('does not DELETE any rows', () => {
    // Dedupe is by rename, not by DELETE. Keeping rows preserves audit history
    // and leaves recovery options open if a wrong row is picked as survivor.
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+system\.secrets\b/i);
  });

  it('does not DROP the secrets table or any of its columns', () => {
    expect(sql).not.toMatch(/DROP\s+TABLE.*secrets/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
