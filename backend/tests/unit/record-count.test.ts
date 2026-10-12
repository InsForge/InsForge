import { describe, expect, it } from 'vitest';
import { decideUnfilteredCount, decideCappedCount } from '../../src/services/database/record-count';
import { APPROX_COUNT_THRESHOLD, FILTERED_COUNT_CAP } from '../../src/utils/constants';

/**
 * The data browser used to run an unbounded COUNT(*) on every page load and every
 * keystroke of search. These pin the strategy that replaces it (#1797).
 */
describe('decideUnfilteredCount', () => {
  it('caps the scan when the table has never been analyzed', () => {
    // PostgreSQL 14+ reports -1 when a table has no statistics yet.
    expect(decideUnfilteredCount(-1)).toEqual({ kind: 'capped' });
  });

  it('caps the scan when reltuples is unavailable', () => {
    expect(decideUnfilteredCount(null)).toEqual({ kind: 'capped' });
  });

  it('caps the scan when reltuples is zero', () => {
    // Ambiguous: an empty table, or an un-analyzed one on older PostgreSQL.
    expect(decideUnfilteredCount(0)).toEqual({ kind: 'capped' });
  });

  it('counts small tables exactly', () => {
    expect(decideUnfilteredCount(1_000)).toEqual({ kind: 'exact' });
    expect(decideUnfilteredCount(APPROX_COUNT_THRESHOLD)).toEqual({ kind: 'exact' });
  });

  it('uses the planner estimate once the table is large enough', () => {
    expect(decideUnfilteredCount(APPROX_COUNT_THRESHOLD + 1)).toEqual({
      kind: 'estimate',
      total: APPROX_COUNT_THRESHOLD + 1,
    });
  });

  it('rounds a fractional reltuples to a whole number of rows', () => {
    expect(decideUnfilteredCount(5_000_000.7)).toEqual({ kind: 'estimate', total: 5_000_001 });
  });

  it('never reports NaN as a total', () => {
    expect(decideUnfilteredCount(Number.NaN)).toEqual({ kind: 'capped' });
    expect(decideUnfilteredCount(Number.POSITIVE_INFINITY)).toEqual({ kind: 'capped' });
  });
});

describe('decideCappedCount', () => {
  it('reports an exact total when the result set fits under the cap', () => {
    expect(decideCappedCount(0, FILTERED_COUNT_CAP)).toEqual({ total: 0, isEstimate: false });
    expect(decideCappedCount(42, FILTERED_COUNT_CAP)).toEqual({ total: 42, isEstimate: false });
  });

  it('treats exactly the cap as an exact total', () => {
    // The query scans cap + 1 rows, so seeing exactly cap proves there are no more.
    expect(decideCappedCount(FILTERED_COUNT_CAP, FILTERED_COUNT_CAP)).toEqual({
      total: FILTERED_COUNT_CAP,
      isEstimate: false,
    });
  });

  it('reports a lower bound once the scan passes the cap', () => {
    expect(decideCappedCount(FILTERED_COUNT_CAP + 1, FILTERED_COUNT_CAP)).toEqual({
      total: FILTERED_COUNT_CAP,
      isEstimate: true,
    });
  });
});
