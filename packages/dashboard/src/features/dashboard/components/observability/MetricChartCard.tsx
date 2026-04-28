import { type MouseEventHandler, type ReactNode, useMemo, useRef, useState } from 'react';
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

interface SparklinePoint {
  x: number;
  y: number;
  timestamp: number;
  value: number;
}

interface SparklineGeometry {
  line: string;
  area: string;
  points: SparklinePoint[];
}

function buildSparkline(data: DashboardMetricDataPoint[], rangeSeconds: number): SparklineGeometry {
  const finite = data
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (finite.length < 2) {
    return { line: '', area: '', points: [] };
  }
  const values = finite.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const valueRange = max - min || 1;

  const windowEnd = Math.floor(Date.now() / 1000);
  const windowStart = windowEnd - rangeSeconds;
  const tRange = Math.max(1, windowEnd - windowStart);

  const points: SparklinePoint[] = finite.map((p) => {
    const rawX = ((p.timestamp - windowStart) / tRange) * SPARKLINE_WIDTH;
    const x = Math.max(0, Math.min(SPARKLINE_WIDTH, rawX));
    const y = SPARKLINE_HEIGHT - ((p.value - min) / valueRange) * SPARKLINE_HEIGHT;
    return { x, y, timestamp: p.timestamp, value: p.value };
  });

  const line = points
    .map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const firstX = points[0].x.toFixed(2);
  const lastX = points[points.length - 1].x.toFixed(2);
  const area = `${line} L${lastX},${SPARKLINE_HEIGHT} L${firstX},${SPARKLINE_HEIGHT} Z`;

  return { line, area, points };
}

function formatHoverTime(ts: number, rangeSeconds: number): string {
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (rangeSeconds < 86_400) {
    return time;
  }
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
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
  const sparkline = useMemo(() => buildSparkline(data, rangeSeconds), [data, rangeSeconds]);
  const xAxisTicks = useMemo(() => {
    const end = Math.floor(Date.now() / 1000);
    const start = end - rangeSeconds;
    const mid = start + Math.floor(rangeSeconds / 2);
    return [start, mid, end].map((ts) => formatHoverTime(ts, rangeSeconds));
  }, [data, rangeSeconds]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const renderValue = (value: number | null) => (value === null ? '—' : formatValue(value));

  const handleMove: MouseEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current;
    if (!svg || sparkline.points.length === 0) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const vbX = ((e.clientX - rect.left) / rect.width) * SPARKLINE_WIDTH;
    let bestIdx = 0;
    let bestDist = Math.abs(sparkline.points[0].x - vbX);
    for (let i = 1; i < sparkline.points.length; i++) {
      const d = Math.abs(sparkline.points[i].x - vbX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    setHoverIdx(bestIdx);
  };

  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx !== null ? sparkline.points[hoverIdx] : null;
  const hoverLeftPct = hover ? (hover.x / SPARKLINE_WIDTH) * 100 : 0;
  const hoverTopPct = hover ? (hover.y / SPARKLINE_HEIGHT) * 100 : 0;
  const tooltipTranslateX = hoverLeftPct < 15 ? '0%' : hoverLeftPct > 85 ? '-100%' : '-50%';

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
        <div className="flex flex-col gap-1">
          <div className="relative h-[100px] w-full">
            {sparkline.line ? (
              <>
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
                  preserveAspectRatio="none"
                  className="h-full w-full cursor-crosshair"
                  onMouseMove={handleMove}
                  onMouseLeave={handleLeave}
                  aria-hidden="true"
                >
                  <path d={sparkline.area} fill="currentColor" className="text-emerald-300/15" />
                  <path
                    d={sparkline.line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="text-emerald-300"
                  />
                </svg>
                {hover && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[var(--alpha-16)]"
                      style={{ left: `${hoverLeftPct}%` }}
                    />
                    <div
                      className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300 ring-2 ring-card"
                      style={{ left: `${hoverLeftPct}%`, top: `${hoverTopPct}%` }}
                    />
                    <div
                      className="pointer-events-none absolute -top-1 z-10 whitespace-nowrap rounded border border-[var(--alpha-8)] bg-toast px-2 py-1 text-xs leading-4 shadow"
                      style={{
                        left: `${hoverLeftPct}%`,
                        transform: `translate(${tooltipTranslateX}, -100%)`,
                      }}
                    >
                      <div className="font-medium text-foreground">{formatValue(hover.value)}</div>
                      <div className="text-muted-foreground">
                        {formatHoverTime(hover.timestamp, rangeSeconds)}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[13px] text-muted-foreground">
                {isLoading ? 'Loading…' : 'No data'}
              </div>
            )}
          </div>
          {sparkline.line && (
            <div className="relative h-4 w-full text-[11px] leading-4 text-muted-foreground">
              <span className="absolute left-0">{xAxisTicks[0]}</span>
              <span className="absolute left-1/2 -translate-x-1/2">{xAxisTicks[1]}</span>
              <span className="absolute right-0">{xAxisTicks[2]}</span>
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
