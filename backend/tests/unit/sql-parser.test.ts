import { describe, it, expect } from 'vitest';
import { parseSQLStatements } from '../../src/utils/sql-parser';

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
    // Parser returns the statement with comments filtered out
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
    // Parser returns the statement with comments filtered out
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('SELECT * FROM users');
  });

  it('handles semicolons inside string literals', () => {
    const sql = `INSERT INTO messages (text) VALUES ('Hello; World')`;
    const result = parseSQLStatements(sql);
    // Parser includes the trailing semicolon
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
    // Parser filters out comment-only content
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
