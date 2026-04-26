import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/035_fix-secrets-deduplicate-and-unique.sql'
);

describe('035_fix-secrets-deduplicate-and-unique migration', () => {
  let sql = '';

  beforeAll(() => {
    // Defer the read so the "file exists" test below can fail cleanly
    // with a clear assertion message instead of an ENOENT thrown during
    // describe-block evaluation.
    if (fs.existsSync(migrationPath)) {
      sql = fs.readFileSync(migrationPath, 'utf8');
    }
  });

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

  it('locks the table to close the dedupe→constraint race window', () => {
    // Without this lock, a concurrent writer can re-introduce duplicates
    // between step 1 (dedupe) and step 2 (ADD CONSTRAINT), making the
    // constraint add fail. SHARE ROW EXCLUSIVE blocks writers but lets
    // SELECTs through.
    expect(sql).toMatch(/LOCK\s+TABLE\s+system\.secrets\s+IN\s+SHARE\s+ROW\s+EXCLUSIVE\s+MODE/i);
  });

  // ── Step 1: Dedupe ────────────────────────────────────────────────────
  it('wraps the dedupe step in a DO block for idempotency', () => {
    expect(sql).toMatch(
      /DO\s*\$\$[\s\S]*?FOR\s+\w+\s+IN[\s\S]*?LOOP[\s\S]*?END\s+LOOP[\s\S]*?\$\$/i
    );
  });

  it('only collapses keys that have more than one row', () => {
    expect(sql).toMatch(/GROUP BY key\s+HAVING\s+count\(\*\)\s*>\s*1/i);
  });

  it('skips API_KEY_OLD_* rows so rotation history is preserved', () => {
    expect(sql).toMatch(/key\s+NOT LIKE\s+'API_KEY_OLD_%'/i);
  });

  it('uses created_at DESC then id DESC as deterministic tiebreakers', () => {
    // The exclusion subquery includes created_at DESC as the primary
    // tiebreaker (after active/unexpired prioritization), then id DESC as
    // a final tiebreaker so the survivor is fully deterministic even when
    // multiple rows share a created_at value.
    expect(sql).toMatch(/created_at\s+DESC\s*,\s*id\s+DESC[\s\S]*?LIMIT\s+1/i);
  });

  it('prioritizes is_active=true AND non-expired rows when picking the survivor', () => {
    // If duplicates include both an active-non-expired row and an
    // inactive/expired one, the migration must keep the active one even if
    // the inactive row has a newer created_at — otherwise we'd deactivate
    // the only row that the read paths actually accept.
    expect(sql).toMatch(
      /CASE[\s\S]*?is_active\s*=\s*true[\s\S]*?expires_at\s+IS\s+NULL\s+OR\s+expires_at\s*>\s*NOW\(\)[\s\S]*?END/i
    );
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

  it('skips constraint add only for a valid, complete, single-column unique index on (key)', () => {
    // pg_index.indisunique alone is not enough — partial, expression, and
    // not-yet-validated unique indexes can exist and don't enforce
    // unconditional uniqueness. The migration must require:
    //   indisunique + indisvalid + indisready
    //   indpred IS NULL  (not partial)
    //   indexprs IS NULL (not expression)
    //   indnkeyatts = 1  (single-column)
    expect(sql).toMatch(/pg_index/i);
    expect(sql).toMatch(/indisunique/);
    expect(sql).toMatch(/indisvalid/);
    expect(sql).toMatch(/indisready/);
    expect(sql).toMatch(/indpred\s+IS\s+NULL/i);
    expect(sql).toMatch(/indexprs\s+IS\s+NULL/i);
    expect(sql).toMatch(/indnkeyatts\s*=\s*1/i);
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
