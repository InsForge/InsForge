import { describe, expect, it } from 'vitest';
import { aggregateMetricSeries } from '#features/dashboard/utils/aggregateMetricSeries';

const point = (timestamp: number, value: number) => ({ timestamp, value });

describe('aggregateMetricSeries', () => {
  it('computes avg, max, and latest-by-timestamp', () => {
    const result = aggregateMetricSeries([point(30, 60), point(10, 90), point(20, 75)]);
    expect(result.avg).toBe(75);
    expect(result.max).toBe(90);
    // latest is the newest timestamp (30 → 60), not the last array element
    expect(result.latest).toBe(60);
  });

  it('returns nulls for an empty series', () => {
    expect(aggregateMetricSeries([])).toEqual({ avg: null, max: null, latest: null });
  });

  it('ignores non-finite values, and returns nulls when nothing is finite', () => {
    const result = aggregateMetricSeries([point(10, NaN), point(20, 80), point(30, Infinity)]);
    expect(result.avg).toBe(80);
    expect(result.max).toBe(80);
    expect(result.latest).toBe(80);

    expect(aggregateMetricSeries([point(10, NaN)])).toEqual({ avg: null, max: null, latest: null });
  });

  it('ignores points with non-finite timestamps', () => {
    const result = aggregateMetricSeries([point(NaN, 100), point(10, 80), point(20, 90)]);

    expect(result.avg).toBe(85);
    expect(result.max).toBe(90);
    expect(result.latest).toBe(90);
  });
});
