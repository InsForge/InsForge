import { beforeAll, describe, it, expect } from 'vitest';
import {
  checkSqlExecutionContextOperations,
  checkSqlTransactionOperations,
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
    expect(checkSqlExecutionContextOperations('SET ROLE postgres')).not.toBeNull();
    expect(checkSqlExecutionContextOperations('SET LOCAL ROLE postgres')).not.toBeNull();
    expect(checkSqlExecutionContextOperations('RESET ROLE')).not.toBeNull();
    expect(checkSqlExecutionContextOperations('SET SESSION AUTHORIZATION postgres')).not.toBeNull();
    expect(checkSqlExecutionContextOperations('RESET SESSION AUTHORIZATION')).not.toBeNull();
  });

  it('blocks role management statements but allows object grants', () => {
    expect(checkSqlExecutionContextOperations('CREATE ROLE app_owner')).not.toBeNull();
    expect(
      checkSqlExecutionContextOperations('ALTER ROLE project_admin SET search_path TO public')
    ).not.toBeNull();
    expect(checkSqlExecutionContextOperations('DROP ROLE app_owner')).not.toBeNull();
    expect(
      checkSqlExecutionContextOperations('GRANT authenticated TO project_admin')
    ).not.toBeNull();
    expect(
      checkSqlExecutionContextOperations('GRANT SELECT ON public.todos TO authenticated')
    ).toBeNull();
  });

  it('blocks transaction control statements', () => {
    expect(checkSqlTransactionOperations('BEGIN')).not.toBeNull();
    expect(checkSqlTransactionOperations('COMMIT')).not.toBeNull();
    expect(checkSqlTransactionOperations('ROLLBACK')).not.toBeNull();
    expect(checkSqlTransactionOperations('SELECT 1')).toBeNull();
  });
});
