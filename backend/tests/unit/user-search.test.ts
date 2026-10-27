import { describe, expect, it } from 'vitest';

import { buildUserSearchFilter } from '@/services/auth/user-search.js';

describe('buildUserSearchFilter', () => {
  it('returns no clause without a search term', () => {
    expect(buildUserSearchFilter(undefined, 'u', 1)).toEqual({ clause: '', params: [] });
    expect(buildUserSearchFilter('', 'u', 1)).toEqual({ clause: '', params: [] });
  });

  it('escapes LIKE wildcards so they match literally', () => {
    const filter = buildUserSearchFilter('50%_off', 'u', 1);

    expect(filter.params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%']);
  });

  it('matches case-insensitively with an explicit escape character', () => {
    const filter = buildUserSearchFilter('Alice', 'u', 1);

    expect(filter.clause).toBe(
      " AND (u.email ILIKE $1 ESCAPE '\\' OR u.profile->>'name' ILIKE $2 ESCAPE '\\')"
    );
  });

  it('qualifies columns only when an alias is given', () => {
    const filter = buildUserSearchFilter('Alice', '', 3);

    expect(filter.clause).toBe(
      " AND (email ILIKE $3 ESCAPE '\\' OR profile->>'name' ILIKE $4 ESCAPE '\\')"
    );
  });

  it('keeps parameter indexes in sync with the surrounding query', () => {
    const filter = buildUserSearchFilter('a_b', '', 2);

    expect(filter.clause).toContain('$2');
    expect(filter.clause).toContain('$3');
    expect(filter.params).toHaveLength(2);
  });
});
