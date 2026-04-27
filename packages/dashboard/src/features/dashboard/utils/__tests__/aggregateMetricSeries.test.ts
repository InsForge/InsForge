import { describe, expect, it } from 'vitest';
import { aggregateMetricSeries } from '../aggregateMetricSeries';

describe('aggregateMetricSeries', () => {
  it('returns null aggregates when data is empty', () => {
    expect(aggregateMetricSeries([])).toEqual({ avg: null, max: null, latest: null });
  });

  it('computes avg, max, latest from a single series', () => {
    const result = aggregateMetricSeries([
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 30 },
      { timestamp: 3, value: 20 },
    ]);
    expect(result.avg).toBeCloseTo(20);
    expect(result.max).toBe(30);
    expect(result.latest).toBe(20);
  });

  it('treats latest as the value at the largest timestamp regardless of input order', () => {
    const result = aggregateMetricSeries([
      { timestamp: 3, value: 5 },
      { timestamp: 1, value: 99 },
      { timestamp: 2, value: 50 },
    ]);
    expect(result.latest).toBe(5);
  });

  it('ignores NaN/non-finite values', () => {
    const result = aggregateMetricSeries([
      { timestamp: 1, value: Number.NaN },
      { timestamp: 2, value: 10 },
      { timestamp: 3, value: 20 },
    ]);
    expect(result.avg).toBeCloseTo(15);
    expect(result.max).toBe(20);
    expect(result.latest).toBe(20);
  });
});
