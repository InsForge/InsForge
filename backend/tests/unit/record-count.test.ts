import { describe, expect, it } from 'vitest';
import {
  decideUnfilteredCount,
  decideFilteredCount,
} from '../../src/services/database/record-count';
import { APPROX_COUNT_THRESHOLD, FILTERED_COUNT_CAP } from '../../src/utils/constants';

/**
 * The dashboard's data browser used to run an unbounded `COUNT(*)` on every page load
 * and every keystroke of search, making it O(N) in table size. These tests pin the
 * decision logic that replaces it: exact counts stay exact where they're cheap, and
 * only large/filtered result sets fall back to an approximation.
 */
describe('decideUnfilteredCount', () => {
  it('falls back to an exact count when the table has never been analyzed', () => {
    // PostgreSQL 14+ reports -1 for a table with no statistics yet.
    expect(decideUnfilteredCount(-1)).toBeNull();
  });

  it('falls back to an exact count when reltuples is unavailable', () => {
    expect(decideUnfilteredCount(null)).toBeNull();
  });

  it('falls back to an exact count when reltuples is zero', () => {
    // Ambiguous: a genuinely empty table, or an un-analyzed one on older PostgreSQL.
    // Counting an empty table is free, so the ambiguity costs nothing.
    expect(decideUnfilteredCount(0)).toBeNull();
  });

  it('keeps the exact count for small tables', () => {
    expect(decideUnfilteredCount(1_000)).toBeNull();
    expect(decideUnfilteredCount(APPROX_COUNT_THRESHOLD)).toBeNull();
  });

  it('uses the planner estimate once the table is large enough', () => {
    const result = decideUnfilteredCount(APPROX_COUNT_THRESHOLD + 1);

    expect(result).toEqual({ total: APPROX_COUNT_THRESHOLD + 1, isEstimate: true });
  });

  it('rounds a fractional reltuples to a whole number of rows', () => {
    expect(decideUnfilteredCount(5_000_000.7)).toEqual({ total: 5_000_001, isEstimate: true });
  });

  it('ignores a non-finite reltuples rather than reporting NaN as a total', () => {
    expect(decideUnfilteredCount(Number.NaN)).toBeNull();
    expect(decideUnfilteredCount(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('decideFilteredCount', () => {
  it('reports an exact total when the result set fits under the cap', () => {
    expect(decideFilteredCount(0)).toEqual({ total: 0, isEstimate: false });
    expect(decideFilteredCount(42)).toEqual({ total: 42, isEstimate: false });
  });

  it('treats exactly the cap as an exact total', () => {
    // The query scans CAP + 1 rows, so seeing exactly CAP proves there are no more.
    expect(decideFilteredCount(FILTERED_COUNT_CAP)).toEqual({
      total: FILTERED_COUNT_CAP,
      isEstimate: false,
    });
  });

  it('reports a lower bound once the scan passes the cap', () => {
    expect(decideFilteredCount(FILTERED_COUNT_CAP + 1)).toEqual({
      total: FILTERED_COUNT_CAP,
      isEstimate: true,
    });
  });
});
