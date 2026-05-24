import { beforeAll, describe, it, expect } from 'vitest';
import {
  checkSqlExecutionGuards,
  initSqlParser,
  parseSQLStatements,
} from '../../src/utils/sql-parser';

beforeAll(async () => {
  await initSqlParser();
});

describe('parseSQLStatements', () => {
  it('splits multiple statements by semicolon', () => {
    const sql = `
      SELECT * FROM users;
      INSERT INTO users (name) VALUES ('John');
      DELETE FROM users WHERE id = 1;
    `;
    const result = parseSQLStatements(sql);
    expect(result).toEqual([
      'SELECT * FROM users',
      "INSERT INTO users (name) VALUES ('John')",
      'DELETE FROM users WHERE id = 1',
    ]);
  });

  it('ignores line comments', () => {
    const sql = `
      -- This is a comment
      SELECT * FROM users; -- Inline comment
    `;
    const result = parseSQLStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('SELECT * FROM users');
  });

  it('ignores block comments', () => {
    const sql = `
      /* Block comment */
      SELECT * FROM users;
      /* Another comment */
    `;
    const result = parseSQLStatements(sql);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('SELECT * FROM users');
  });

  it('handles semicolons inside string literals', () => {
    const sql = `INSERT INTO messages (text) VALUES ('Hello; World')`;
    const result = parseSQLStatements(sql);
    expect(result).toEqual([`INSERT INTO messages (text) VALUES ('Hello; World')`]);
  });

  it('throws error on empty input', () => {
    expect(() => parseSQLStatements('')).toThrow();
  });

  it('returns empty array for comments-only SQL', () => {
    const sql = `
      -- Only comment
      /* Another comment */
    `;
    const result = parseSQLStatements(sql);
    expect(result).toEqual([]);
  });

  it('trims statements and removes empty results', () => {
    const sql = `
      SELECT * FROM users;
      -- comment
      INSERT INTO users (id) VALUES (1);
    `;
    const result = parseSQLStatements(sql);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('SELECT * FROM users');
    expect(result[result.length - 1] || result[0]).toContain('INSERT INTO users');
  });
});

describe('SQL execution guards', () => {
  it('blocks role and session authorization changes', () => {
    expect(checkSqlExecutionGuards('SET ROLE postgres')).not.toBeNull();
    expect(checkSqlExecutionGuards('SET LOCAL ROLE postgres')).not.toBeNull();
    expect(checkSqlExecutionGuards('RESET ROLE')).not.toBeNull();
    expect(checkSqlExecutionGuards('SET SESSION AUTHORIZATION postgres')).not.toBeNull();
    expect(checkSqlExecutionGuards('RESET SESSION AUTHORIZATION')).not.toBeNull();
    expect(checkSqlExecutionGuards("SELECT set_config('role', 'postgres', false)")).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT set_config('role'::text, 'postgres', false)")
    ).not.toBeNull();
    expect(checkSqlExecutionGuards("SELECT set_config($1, 'postgres', false)")).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT set_config('ro' || 'le', 'postgres', false)")
    ).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT pg_catalog.set_config('role', 'postgres', false)")
    ).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT pg_catalog.\"set_config\"('role', 'postgres', false)")
    ).not.toBeNull();
    expect(checkSqlExecutionGuards("SELECT set_config('app.safe', 'value', false)")).not.toBeNull();
  });

  it('blocks role management statements but allows object grants', () => {
    expect(checkSqlExecutionGuards('CREATE ROLE app_owner')).not.toBeNull();
    expect(
      checkSqlExecutionGuards('ALTER ROLE project_admin SET search_path TO public')
    ).not.toBeNull();
    expect(checkSqlExecutionGuards('DROP ROLE app_owner')).not.toBeNull();
    expect(checkSqlExecutionGuards('GRANT authenticated TO project_admin')).not.toBeNull();
    expect(checkSqlExecutionGuards('GRANT SELECT ON public.todos TO authenticated')).toBeNull();
  });

  it('blocks transaction control statements', () => {
    expect(checkSqlExecutionGuards('BEGIN')).not.toBeNull();
    expect(checkSqlExecutionGuards('COMMIT')).not.toBeNull();
    expect(checkSqlExecutionGuards('ROLLBACK')).not.toBeNull();
    expect(checkSqlExecutionGuards('SELECT 1')).toBeNull();
  });

  it('blocks search_path changes without matching comments or strings', () => {
    expect(checkSqlExecutionGuards('SET search_path TO public')).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT set_config('search_path', 'public', false)")
    ).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT set_config('search_path'::text, 'public', false)")
    ).not.toBeNull();
    expect(checkSqlExecutionGuards("SELECT 'SET search_path TO public'")).toBeNull();
    expect(checkSqlExecutionGuards('-- SET search_path TO public\nSELECT 1')).toBeNull();
  });

  it('blocks reset-all and statement timeout changes', () => {
    expect(checkSqlExecutionGuards('RESET ALL')).not.toBeNull();
    expect(checkSqlExecutionGuards('SET statement_timeout = 0')).not.toBeNull();
    expect(checkSqlExecutionGuards('RESET statement_timeout')).not.toBeNull();
    expect(
      checkSqlExecutionGuards("SELECT set_config('statement_timeout', '0', false)")
    ).not.toBeNull();
  });

  it('blocks set_config inside DO blocks without blocking ordinary DO blocks', () => {
    expect(
      checkSqlExecutionGuards(`
        DO $$
        BEGIN
          PERFORM set_config('role', 'postgres', false);
        END $$;
      `)
    ).not.toBeNull();

    expect(
      checkSqlExecutionGuards(`
        DO $$
        BEGIN
          RAISE NOTICE 'hello';
        END $$;
      `)
    ).toBeNull();
  });

  it('blocks database-level operations without matching comments or strings', () => {
    expect(checkSqlExecutionGuards('DROP DATABASE customer_project')).not.toBeNull();
    expect(checkSqlExecutionGuards("SELECT 'DROP DATABASE customer_project'")).toBeNull();
    expect(checkSqlExecutionGuards('-- DROP DATABASE customer_project\nSELECT 1')).toBeNull();
  });
});
