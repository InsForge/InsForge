import { describe, expect, it } from 'vitest';
import { TEXT_LIKE_DATA_TYPES } from '../../src/utils/constants';

/**
 * Tests the empty-string stripping contract used by records.routes.ts.
 *
 * Both single-record and bulk-record write paths should apply the same rule:
 *   - Strip empty strings for non-text-like columns (uuid, integer, boolean, date, etc.)
 *   - Preserve empty strings for text-like columns (text, character varying, character, citext)
 *
 * This matches the canonical logic in AdminRecordService.sanitizeInsertRecord().
 */

/** Replicates the filtering logic from records.routes.ts for a single record. */
function filterRecord(
  record: Record<string, unknown>,
  columnTypeMap: Record<string, string>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const key in record) {
    if (!TEXT_LIKE_DATA_TYPES.has(columnTypeMap[key] ?? '') && record[key] === '') {
      continue;
    }
    filtered[key] = record[key];
  }
  return filtered;
}

describe('records empty-string stripping', () => {
  const columnTypeMap: Record<string, string> = {
    id: 'uuid',
    name: 'text',
    description: 'character varying',
    tag: 'character',
    note: 'citext',
    count: 'integer',
    price: 'numeric',
    is_active: 'boolean',
    created_at: 'timestamp with time zone',
    metadata: 'jsonb',
  };

  describe('strips empty strings for non-text-like columns', () => {
    it.each([
      ['uuid', 'id'],
      ['integer', 'count'],
      ['numeric', 'price'],
      ['boolean', 'is_active'],
      ['timestamp with time zone', 'created_at'],
      ['jsonb', 'metadata'],
    ])('strips empty string for %s column (%s)', (_type, column) => {
      const result = filterRecord({ [column]: '' }, columnTypeMap);
      expect(result).not.toHaveProperty(column);
    });
  });

  describe('preserves empty strings for text-like columns', () => {
    it.each([
      ['text', 'name'],
      ['character varying', 'description'],
      ['character', 'tag'],
      ['citext', 'note'],
    ])('preserves empty string for %s column (%s)', (_type, column) => {
      const result = filterRecord({ [column]: '' }, columnTypeMap);
      expect(result).toHaveProperty(column, '');
    });
  });

  it('strips empty string for unknown column (safe default)', () => {
    const result = filterRecord({ unknown_col: '' }, columnTypeMap);
    expect(result).not.toHaveProperty('unknown_col');
  });

  it('preserves non-empty values regardless of column type', () => {
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Test',
      count: '42',
      is_active: 'true',
    };
    const result = filterRecord(record, columnTypeMap);
    expect(result).toEqual(record);
  });

  it('applies the same filtering for single and bulk records', () => {
    const record = {
      id: '',
      name: '',
      description: '',
      count: '',
      is_active: '',
    };

    // Single-record path
    const singleResult = filterRecord(record, columnTypeMap);

    // Bulk-record path (same logic applied via Array.map)
    const bulkResult = [record].map((item) => filterRecord(item, columnTypeMap))[0];

    expect(singleResult).toEqual(bulkResult);
    expect(singleResult).toEqual({
      name: '',
      description: '',
    });
  });

  describe('TEXT_LIKE_DATA_TYPES set', () => {
    it('contains exactly the expected types', () => {
      expect([...TEXT_LIKE_DATA_TYPES].sort()).toEqual(
        ['character', 'character varying', 'citext', 'text'].sort()
      );
    });
  });
});
