import { describe, expect, it } from 'vitest';
import { filterEmptyStringsForColumnTypes } from '../../src/api/routes/database/record-body-filter';

describe('filterEmptyStringsForColumnTypes', () => {
  const columnTypes = {
    id: 'uuid',
    title: 'text',
    count: 'integer',
    enabled: 'boolean',
    publishedAt: 'timestamp with time zone',
    slug: 'character varying',
    code: 'character',
    email: 'citext',
  };

  it('strips empty strings from non-text columns for single-record payloads', () => {
    expect(
      filterEmptyStringsForColumnTypes(
        { id: '', title: '', count: '', enabled: '', publishedAt: '', notes: 'keep' },
        columnTypes
      )
    ).toEqual({ title: '', notes: 'keep' });
  });

  it('uses the same filtering semantics for bulk payloads', () => {
    expect(
      filterEmptyStringsForColumnTypes(
        [
          { id: '', title: '', count: '', enabled: true },
          { id: 'uuid-1', title: 'ok', count: 0, publishedAt: '' },
        ],
        columnTypes
      )
    ).toEqual([
      { title: '', enabled: true },
      { id: 'uuid-1', title: 'ok', count: 0 },
    ]);
  });

  it('preserves empty strings for all text-like column types and unknown columns', () => {
    expect(
      filterEmptyStringsForColumnTypes(
        { title: '', slug: '', code: '', email: '', unknownCol: '', count: '' },
        columnTypes
      )
    ).toEqual({ title: '', slug: '', code: '', email: '', unknownCol: '' });
  });

  it('leaves non-empty falsey values intact', () => {
    expect(
      filterEmptyStringsForColumnTypes({ count: 0, enabled: false, title: '' }, columnTypes)
    ).toEqual({ count: 0, enabled: false, title: '' });
  });
});
