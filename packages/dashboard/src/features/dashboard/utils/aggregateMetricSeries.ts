import type { DashboardMetricDataPoint } from '#types';

export interface MetricAggregates {
  avg: number | null;
  max: number | null;
  latest: number | null;
}

export function aggregateMetricSeries(data: DashboardMetricDataPoint[]): MetricAggregates {
  const finite = data.filter((point) => Number.isFinite(point.value));
  if (finite.length === 0) {
    return { avg: null, max: null, latest: null };
  }
  let sum = 0;
  let max = -Infinity;
  let latestPoint = finite[0];
  for (const point of finite) {
    sum += point.value;
    if (point.value > max) {
      max = point.value;
    }
    if (point.timestamp > latestPoint.timestamp) {
      latestPoint = point;
    }
  }
  return {
    avg: sum / finite.length,
    max,
    latest: latestPoint.value,
  };
}
