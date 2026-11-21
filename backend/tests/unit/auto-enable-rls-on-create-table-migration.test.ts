import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '068_auto_enable_rls_on_create_table.sql';
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.join(migrationDir, migrationFile);
const dockerInitPath = path.resolve(currentDir, '../../../deploy/docker-init/db/db-init.sql');
const zeaburTemplatePath = path.resolve(currentDir, '../../../deploy/zeabur/template.yml');

function extractSqlBlock(source: string, startPattern: RegExp, endPattern: RegExp): string {
  const match = source.match(
    new RegExp(`${startPattern.source}[\\s\\S]*?${endPattern.source}`, 'i')
  );
  return match ? match[0] : '';
}

function assertValidExtractedBlock(
  extracted: string,
  sourceName: string,
  expectedPattern: RegExp
): void {
  expect(
    extracted,
    `Expected extracted SQL block from ${sourceName} to be a non-empty string, but got empty.`
  ).toBeTruthy();
  expect(
    extracted.length,
    `Expected extracted SQL block from ${sourceName} to have content, but length was 0.`
  ).toBeGreaterThan(0);
  expect(
    extracted,
    `Expected extracted SQL from ${sourceName} to match expected pattern (${expectedPattern.source}).`
  ).toMatch(expectedPattern);
}

function matchDollarQuoteDelimiter(sql: string, i: number): string | null {
  if (sql[i] !== '$') return null;
  const rest = sql.slice(i);
  // Match $$ or $tag$ where tag starts with letter/underscore followed by letters/digits/underscores
  const match = rest.match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match ? match[0] : null;
}

interface NormalizeSqlOptions {
  /**
   * When true, normalizes executable SQL/PLpgSQL statements inside dollar quotes
   * (e.g. for function body semantic parity across files with different comment/indentation formatting)
   * while still strictly preserving single-quoted string literals and quoted identifiers.
   * Defaults to false (preserving entire dollar-quoted content verbatim).
   */
  normalizeDollarQuotes?: boolean;
}

/**
 * Lexical SQL normalizer for cross-file parity comparison and SQL assertion hardening.
 *
 * Normalizes SQL by collapsing whitespace and stripping comments outside of:
 * - Single-quoted string literals: '...'
 * - Double-quoted identifiers: "..."
 * - PostgreSQL dollar-quoted strings: $$...$$, $function$...$function$, $body$...$body$, etc.
 *
 * Inside quoted content:
 * - Comments (-- ..., /* ... * /) are preserved as literal content.
 * - Whitespace (including indentation and repeated spaces) is preserved exactly.
 * - Letter casing is preserved exactly.
 *
 * Non-delimiter dollar signs ($1 positional parameters, $100 currency, isolated $)
 * are not confused with dollar-quote delimiters.
 */
function normalizeSql(sql: string, options: NormalizeSqlOptions = {}): string {
  const { normalizeDollarQuotes = false } = options;
  let result = '';
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // Single-quoted string literal: '...' (supporting '' escape)
    if (ch === "'") {
      result += ch;
      i++;
      while (i < len) {
        const c = sql[i];
        result += c;
        if (c === "'") {
          if (i + 1 < len && sql[i + 1] === "'") {
            i++;
            result += sql[i];
          } else {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }

    // Double-quoted identifier: "..." (supporting "" escape)
    if (ch === '"') {
      result += ch;
      i++;
      while (i < len) {
        const c = sql[i];
        result += c;
        if (c === '"') {
          if (i + 1 < len && sql[i + 1] === '"') {
            i++;
            result += sql[i];
          } else {
            i++;
            break;
          }
        }
        i++;
      }
      continue;
    }

    // Dollar-quoted string: $$ ... $$ or $tag$ ... $tag$
    const dollarDelimiter = matchDollarQuoteDelimiter(sql, i);
    if (dollarDelimiter !== null) {
      const closeIdx = sql.indexOf(dollarDelimiter, i + dollarDelimiter.length);
      if (closeIdx !== -1) {
        const innerContent = sql.slice(i + dollarDelimiter.length, closeIdx);
        if (normalizeDollarQuotes) {
          result +=
            dollarDelimiter + ' ' + normalizeSql(innerContent, options) + ' ' + dollarDelimiter;
        } else {
          result += dollarDelimiter + innerContent + dollarDelimiter;
        }
        i = closeIdx + dollarDelimiter.length;
        continue;
      } else {
        // Unclosed dollar quote: conservative preservation
        result += sql.slice(i);
        break;
      }
    }

    // Line comment: --
    if (ch === '-' && i + 1 < len && sql[i + 1] === '-') {
      i += 2;
      while (i < len && sql[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && i + 1 < len && sql[i + 1] === '*') {
      i += 2;
      while (i < len && !(sql[i] === '*' && i + 1 < len && sql[i + 1] === '/')) {
        i++;
      }
      if (i < len) {
        i += 2; // skip */
      }
      continue;
    }

    // Whitespace outside strings/identifiers: collapse sequences to single space
    if (/\s/.test(ch)) {
      if (result.length > 0 && !result.endsWith(' ')) {
        result += ' ';
      }
      i++;
      while (i < len && /\s/.test(sql[i])) {
        i++;
      }
      continue;
    }

    // Normal SQL token character
    result += ch;
    i++;
  }

  return result.trim();
}

describe('auto-enable-rls-on-create-table migration (068)', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const dockerInitSql = fs.readFileSync(dockerInitPath, 'utf8');
  const zeaburTemplateSql = fs.readFileSync(zeaburTemplatePath, 'utf8');

  it('defines the auto_enable_rls function in schema system with SECURITY DEFINER', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION system\.auto_enable_rls\(\)/i);
    expect(sql).toMatch(/RETURNS event_trigger/i);
    expect(sql).toMatch(/LANGUAGE plpgsql/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
  });

  it('hardens search_path to prevent injection attacks', () => {
    expect(sql).toMatch(/SET search_path = pg_catalog, pg_temp/i);
  });

  it('inspects pg_event_trigger_ddl_commands for CREATE TABLE, CREATE TABLE AS, and SELECT INTO', () => {
    expect(sql).toMatch(/pg_event_trigger_ddl_commands\(\)/i);
    expect(sql).toMatch(/command_tag IN \('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'\)/i);
  });

  it('scopes auto-enforcement strictly to schema public and excludes extensions', () => {
    expect(sql).toMatch(/cmd\.schema_name = 'public'/i);
    expect(sql).toMatch(/cmd\.in_extension IS NULL OR NOT cmd\.in_extension/i);
  });

  it('targets ordinary and partitioned tables while excluding temporary tables', () => {
    expect(sql).toMatch(/c\.relkind IN \('r', 'p'\)/i);
    expect(sql).toMatch(/c\.relpersistence <> 't'/i);
  });

  it('is idempotent and checks NOT c.relrowsecurity before enabling', () => {
    expect(sql).toMatch(/NOT c\.relrowsecurity/i);
  });

  it('formats SQL safely using identifier quoting (%I)', () => {
    expect(sql).toMatch(
      /format\('ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY', cmd\.schema_name, v_relname\)/i
    );
  });

  it('grants EXECUTE on the function to project_admin when present', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION system\.auto_enable_rls\(\) TO project_admin/i);
  });

  it('installs the event trigger on ddl_command_end idempotently', () => {
    expect(sql).toMatch(/DROP EVENT TRIGGER IF EXISTS auto_enable_rls_on_create_table;/i);
    expect(sql).toMatch(/CREATE EVENT TRIGGER auto_enable_rls_on_create_table/i);
    expect(sql).toMatch(/ON ddl_command_end/i);
    expect(sql).toMatch(/EXECUTE FUNCTION system\.auto_enable_rls\(\)/i);
  });

  it('synchronizes deploy/docker-init/db/db-init.sql with the new event trigger', () => {
    expect(dockerInitSql).toMatch(/system\.auto_enable_rls/i);
    expect(dockerInitSql).toMatch(/auto_enable_rls_on_create_table/i);
    expect(dockerInitSql).not.toMatch(/create_policies_on_table_create/i);
    expect(dockerInitSql).not.toMatch(/create_default_policies\(\)/i);
  });

  it('preserves "--" and comment-like markers inside string literals during normalization', () => {
    const sqlWithCommentInString =
      "SELECT * FROM public.audit_logs WHERE description = '-- not a comment';";
    expect(normalizeSql(sqlWithCommentInString)).toBe(
      "SELECT * FROM public.audit_logs WHERE description = '-- not a comment';"
    );
  });

  it('preserves repeated whitespace inside string literals during normalization', () => {
    const sqlWithSpacesInString = "SELECT 'hello    world' AS greeting;";
    expect(normalizeSql(sqlWithSpacesInString)).toBe("SELECT 'hello    world' AS greeting;");
  });

  it('preserves case differences in string literals during normalization', () => {
    const sqlUpper = "SELECT * FROM public.users WHERE status = 'ACTIVE'";
    const sqlLower = "SELECT * FROM public.users WHERE status = 'active'";
    expect(normalizeSql(sqlUpper)).not.toBe(normalizeSql(sqlLower));
  });

  it('preserves case differences in quoted identifiers during normalization', () => {
    const sqlQuotedUpper = 'SELECT "ColumnName" FROM tbl';
    const sqlQuotedLower = 'SELECT "columnname" FROM tbl';
    expect(normalizeSql(sqlQuotedUpper)).not.toBe(normalizeSql(sqlQuotedLower));
  });

  it('preserves comments inside "$$ ... $$" during normalization', () => {
    const sqlWithCommentInDollar = 'SELECT $$ -- comment inside\nstill here $$;';
    expect(normalizeSql(sqlWithCommentInDollar)).toBe(
      'SELECT $$ -- comment inside\nstill here $$;'
    );
  });

  it('preserves repeated whitespace inside a dollar-quoted body during normalization', () => {
    const sqlWithSpacesInDollar = 'SELECT $$hello    world$$;';
    expect(normalizeSql(sqlWithSpacesInDollar)).toBe('SELECT $$hello    world$$;');
  });

  it('preserves case differences inside dollar-quoted content during normalization', () => {
    const sqlDollarUpper = 'SELECT $$ACTIVE$$;';
    const sqlDollarLower = 'SELECT $$active$$;';
    expect(normalizeSql(sqlDollarUpper)).not.toBe(normalizeSql(sqlDollarLower));
  });

  it('recognizes tagged dollar quotes ($function$, $body$) and preserves their content', () => {
    const sqlTagged = "CREATE FUNCTION f() AS $func$\n  -- comment\n  RETURN 'val';\n$func$;";
    expect(normalizeSql(sqlTagged)).toBe(
      "CREATE FUNCTION f() AS $func$\n  -- comment\n  RETURN 'val';\n$func$;"
    );
    const sqlBody = 'DO $body$\n  SELECT * FROM test;\n$body$;';
    expect(normalizeSql(sqlBody)).toBe('DO $body$\n  SELECT * FROM test;\n$body$;');
  });

  it('does not treat positional parameters or unrelated dollar signs as dollar-quote delimiters', () => {
    const sqlParam = 'SELECT * FROM public.users WHERE id = $1 AND price > $100 AND score > $;';
    expect(normalizeSql(sqlParam)).toBe(
      'SELECT * FROM public.users WHERE id = $1 AND price > $100 AND score > $;'
    );
  });

  it('fails when an extracted SQL block is missing or empty', () => {
    const emptyExtracted = extractSqlBlock('SELECT 1;', /MISSING_START/, /MISSING_END/);
    expect(emptyExtracted).toBe('');
    expect(() =>
      assertValidExtractedBlock(emptyExtracted, 'dummy_source', /auto_enable_rls/)
    ).toThrow(/Expected extracted SQL block from dummy_source to be a non-empty string/);
  });

  it('maintains exact semantic parity of system.auto_enable_rls() between migration, docker-init, and zeabur template', () => {
    const fnStart = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+system\.auto_enable_rls\s*\(\)/;
    const fnEnd = /\$\$;/;

    const rawMigrationFn = extractSqlBlock(sql, fnStart, fnEnd);
    const rawDockerInitFn = extractSqlBlock(dockerInitSql, fnStart, fnEnd);
    const rawZeaburFn = extractSqlBlock(zeaburTemplateSql, fnStart, fnEnd);

    assertValidExtractedBlock(
      rawMigrationFn,
      '068 migration',
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+system\.auto_enable_rls/
    );
    assertValidExtractedBlock(
      rawDockerInitFn,
      'deploy/docker-init/db/db-init.sql',
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+system\.auto_enable_rls/
    );
    assertValidExtractedBlock(
      rawZeaburFn,
      'deploy/zeabur/template.yml',
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+system\.auto_enable_rls/
    );

    const migrationFn = normalizeSql(rawMigrationFn, { normalizeDollarQuotes: true });
    const dockerInitFn = normalizeSql(rawDockerInitFn, { normalizeDollarQuotes: true });
    const zeaburFn = normalizeSql(rawZeaburFn, { normalizeDollarQuotes: true });

    expect(dockerInitFn).toBe(migrationFn);
    expect(zeaburFn).toBe(migrationFn);
  });

  it('maintains exact semantic parity of auto_enable_rls_on_create_table event trigger between migration, docker-init, and zeabur template', () => {
    const triggerStart = /CREATE\s+EVENT\s+TRIGGER\s+auto_enable_rls_on_create_table/;
    const triggerEnd = /EXECUTE\s+FUNCTION\s+system\.auto_enable_rls\s*\(\);/;

    const rawMigrationTrigger = extractSqlBlock(sql, triggerStart, triggerEnd);
    const rawDockerInitTrigger = extractSqlBlock(dockerInitSql, triggerStart, triggerEnd);
    const rawZeaburTrigger = extractSqlBlock(zeaburTemplateSql, triggerStart, triggerEnd);

    assertValidExtractedBlock(
      rawMigrationTrigger,
      '068 migration',
      /CREATE\s+EVENT\s+TRIGGER\s+auto_enable_rls_on_create_table/
    );
    assertValidExtractedBlock(
      rawDockerInitTrigger,
      'deploy/docker-init/db/db-init.sql',
      /CREATE\s+EVENT\s+TRIGGER\s+auto_enable_rls_on_create_table/
    );
    assertValidExtractedBlock(
      rawZeaburTrigger,
      'deploy/zeabur/template.yml',
      /CREATE\s+EVENT\s+TRIGGER\s+auto_enable_rls_on_create_table/
    );

    const migrationTrigger = normalizeSql(rawMigrationTrigger);
    const dockerInitTrigger = normalizeSql(rawDockerInitTrigger);
    const zeaburTrigger = normalizeSql(rawZeaburTrigger);

    expect(dockerInitTrigger).toBe(migrationTrigger);
    expect(zeaburTrigger).toBe(migrationTrigger);
  });
});
