import splitSqlQuery from '@databases/split-sql-query';
import sql from '@databases/sql';
import logger from './logger.js';

/**
 * Parse a SQL string into individual statements, properly handling:
 * - String literals with embedded semicolons
 * - Escaped quotes
 * - Comments (both -- and block comment style)
 * - Complex nested statements
 *
 * @param sqlText The raw SQL text to parse
 * @returns Array of SQL statement strings
 * @throws Error if the SQL cannot be parsed
 */
export function parseSQLStatements(sqlText: string): string[] {
  if (!sqlText || typeof sqlText !== 'string') {
    throw new Error('SQL text must be a non-empty string');
  }

  try {
    // Create an SQLQuery object from the raw SQL string
    const sqlQuery = sql`${sql.__dangerous__rawValue(sqlText)}`;

    // splitSqlQuery correctly handles:
    // - String literals with embedded semicolons
    // - Escaped quotes
    // - Comments (both -- and /* */ style)
    // - Complex nested statements
    const splitResults = splitSqlQuery(sqlQuery);

    // Convert SQLQuery objects back to strings and filter
    const statements = splitResults
      .map((query) => {
        // Extract the raw SQL text from the SQLQuery object
        // Use a simple formatter that just returns the SQL text
        const formatted = query.format({
          escapeIdentifier: (str: string) => `"${str}"`,
          formatValue: (_value: unknown, index: number) => ({
            placeholder: `$${index + 1}`,
            value: _value,
          }),
        });
        return formatted.text.trim();
      })
      .filter((s) => {
        // Remove statements that are only comments or empty
        const withoutComments = s
          .replace(/--.*$/gm, '') // Remove line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
          .trim();
        return withoutComments.length;
      });

    logger.debug(`Parsed ${statements.length} SQL statements from input`);
    return statements;
  } catch (parseError) {
    logger.error('Failed to parse SQL:', parseError);
    throw new Error(
      `Invalid SQL format: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    );
  }
}
