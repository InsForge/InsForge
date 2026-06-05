import { describe, it, expect } from 'vitest';
import {
  findDuplicateMigrations,
  ALLOWED_DUPLICATES,
} from '../../scripts/check-migration-duplicates.ts';

describe('migration numbers', () => {
  it('has no duplicate numbers except the grandfathered 033 and 047', () => {
    const { newDuplicates } = findDuplicateMigrations();

    // newDuplicates excludes ALLOWED_DUPLICATES (033, 047). Anything here is a
    // real collision that must be renumbered before merging.
    expect(
      newDuplicates,
      `Duplicate migration number(s): ${newDuplicates
        .map((d) => `${d.prefix} (${d.files.join(', ')})`)
        .join('; ')}`
    ).toEqual([]);
  });

  it('grandfathers exactly 033 and 047', () => {
    expect([...ALLOWED_DUPLICATES].sort()).toEqual(['033', '047']);
  });
});
