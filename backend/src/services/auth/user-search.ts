import { escapeSqlLikePattern } from '@/utils/validations.js';

export interface UserSearchFilter {
  /** SQL fragment starting with ` AND (...)`, or an empty string without a search. */
  clause: string;
  params: string[];
}

/**
 * Build the `email OR profile name` filter used by the admin user list.
 *
 * The search text is data, not pattern syntax: `_` and `%` are escaped so a
 * term like `a_b` matches only `a_b`, and `ILIKE` makes the match
 * case-insensitive, as the UI implies. `ESCAPE '\'` tells Postgres which
 * character `escapeSqlLikePattern` used.
 *
 * @param search     Raw search text from the caller.
 * @param userAlias  Table alias to qualify the columns with, or empty.
 * @param startIndex 1-based position of the first placeholder in the query.
 */
export function buildUserSearchFilter(
  search: string | undefined,
  userAlias: string,
  startIndex: number
): UserSearchFilter {
  if (!search) {
    return { clause: '', params: [] };
  }

  const qualify = (column: string) => (userAlias ? `${userAlias}.${column}` : column);
  const pattern = `%${escapeSqlLikePattern(search)}%`;
  const clause =
    ` AND (${qualify('email')} ILIKE $${startIndex} ESCAPE '\\'` +
    ` OR ${qualify("profile->>'name'")} ILIKE $${startIndex + 1} ESCAPE '\\')`;

  return { clause, params: [pattern, pattern] };
}
