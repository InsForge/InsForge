import { type ReactNode, useMemo } from 'react';
import type { DashboardMetricDataPoint } from '../../../../types';
import { aggregateMetricSeries } from '../../utils/aggregateMetricSeries';

export interface MetricChartCardProps {
  title: string;
  icon: ReactNode;
  data: DashboardMetricDataPoint[];
  rangeSeconds: number;
  formatValue: (value: number) => string;
  isLoading?: boolean;
}

const SPARKLINE_WIDTH = 434;
const SPARKLINE_HEIGHT = 100;

function buildSparklinePaths(data: DashboardMetricDataPoint[], rangeSeconds: number) {
  const finite = data
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (finite.length < 2) {
    return { line: '', area: '' };
  }
  const values = finite.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valueRange = max - min || 1;

  const windowEnd = Math.floor(Date.now() / 1000);
  const windowStart = windowEnd - rangeSeconds;
  const tRange = Math.max(1, windowEnd - windowStart);

  const points = finite.map((p) => {
    const rawX = ((p.timestamp - windowStart) / tRange) * SPARKLINE_WIDTH;
    const x = Math.max(0, Math.min(SPARKLINE_WIDTH, rawX));
    const y = SPARKLINE_HEIGHT - ((p.value - min) / valueRange) * SPARKLINE_HEIGHT;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const firstX = points[0][0].toFixed(2);
  const lastX = points[points.length - 1][0].toFixed(2);
  const area = `${line} L${lastX},${SPARKLINE_HEIGHT} L${firstX},${SPARKLINE_HEIGHT} Z`;

  return { line, area };
}

export function MetricChartCard({
  title,
  icon,
  data,
  rangeSeconds,
  formatValue,
  isLoading,
}: MetricChartCardProps) {
  const aggregates = useMemo(() => aggregateMetricSeries(data), [data]);
  const paths = useMemo(() => buildSparklinePaths(data, rangeSeconds), [data, rangeSeconds]);

  const renderValue = (value: number | null) => (value === null ? '—' : formatValue(value));

  return (
    <div className="flex flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5 text-[13px] leading-[22px] text-muted-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
          <span className="truncate">{title}</span>
        </div>
        <p className="text-[20px] font-medium leading-7 text-foreground">
          {isLoading ? '—' : renderValue(aggregates.latest)}
        </p>
        <div className="h-[100px] w-full">
          {paths.line ? (
            <svg
              viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
              preserveAspectRatio="none"
              className="h-full w-full"
              aria-hidden="true"
            >
              <path d={paths.area} fill="currentColor" className="text-emerald-300/15" />
              <path
                d={paths.line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="text-emerald-300"
              />
            </svg>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[13px] text-muted-foreground">
              {isLoading ? 'Loading…' : 'No data'}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-[var(--alpha-8)]">
        {(['AVG', 'MAX', 'LATEST'] as const).map((label, i) => {
          const value = i === 0 ? aggregates.avg : i === 1 ? aggregates.max : aggregates.latest;
          return (
            <div
              key={label}
              className={`flex flex-col items-center justify-center gap-1 py-4 ${
                i < 2 ? 'border-r border-[var(--alpha-8)]' : ''
              }`}
            >
              <span className="text-xs leading-4 text-muted-foreground">{label}</span>
              <span className="text-sm leading-5 text-foreground">
                {isLoading ? '—' : renderValue(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
