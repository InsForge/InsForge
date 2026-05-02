import { type MouseEventHandler, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import type { DashboardMetricDataPoint } from '#types';
import { aggregateMetricSeries } from '#features/dashboard/utils/aggregateMetricSeries';

export interface MetricChartCardProps {
  title: string;
  icon: ReactNode;
  data: DashboardMetricDataPoint[];
  rangeSeconds: number;
  formatValue: (value: number) => string;
  isLoading?: boolean;
  threshold?: number;
}

const SPARKLINE_WIDTH = 434;
const SPARKLINE_HEIGHT = 100;
// Figma reserves 29px on the left for the y-axis labels (e.g. "85%"), so the
// threshold dashed line and reference grid start after them.
const Y_AXIS_LABEL_WIDTH = 29;

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
  min: number | null;
  max: number | null;
}

function buildSparkline(
  data: DashboardMetricDataPoint[],
  rangeSeconds: number,
  fixedDomain?: [number, number]
): SparklineGeometry {
  const finite = data
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (finite.length < 2) {
    return { line: '', area: '', points: [], min: null, max: null };
  }
  const values = finite.map((p) => p.value);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const min = fixedDomain ? fixedDomain[0] : dataMin;
  const max = fixedDomain ? fixedDomain[1] : dataMax;
  const valueRange = max - min || 1;

  // Anchor the right edge of the chart to the last data point's timestamp
  // (rather than "now"), so the line always reaches the right edge regardless
  // of how stale the data is.
  const lastTimestamp = finite[finite.length - 1].timestamp;
  const windowEnd = lastTimestamp;
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

  return { line, area, points, min, max };
}

function formatHoverTime(ts: number, rangeSeconds: number): string {
  const d = new Date(ts * 1000);
  const time = d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (rangeSeconds < 86_400) {
    return time;
  }
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

const FIXED_PERCENT_DOMAIN: [number, number] = [0, 100];

export function MetricChartCard({
  title,
  icon,
  data,
  rangeSeconds,
  formatValue,
  isLoading,
  threshold,
}: MetricChartCardProps) {
  const aggregates = useMemo(() => aggregateMetricSeries(data), [data]);
  const sparkline = useMemo(
    () =>
      buildSparkline(
        data,
        rangeSeconds,
        threshold !== undefined ? FIXED_PERCENT_DOMAIN : undefined
      ),
    [data, rangeSeconds, threshold]
  );
  const gradientId = useId();
  const xAxisTicks = useMemo(() => {
    const finite = data.filter((p) => Number.isFinite(p.value));
    const end =
      finite.length > 0 ? finite[finite.length - 1].timestamp : Math.floor(Date.now() / 1000);
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

  const thresholdOffsetPct = threshold !== undefined ? 100 - threshold : 0;
  const gradientTransitionHalfWidth = 8;
  const gradientTransitionStart = Math.max(
    0,
    Math.min(100, thresholdOffsetPct - gradientTransitionHalfWidth)
  );
  const gradientTransitionEnd = Math.max(
    0,
    Math.min(100, thresholdOffsetPct + gradientTransitionHalfWidth)
  );

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
          <div className="relative h-[100px]">
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
                  {threshold !== undefined && (
                    <defs>
                      <linearGradient
                        id={`${gradientId}-line`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2={SPARKLINE_HEIGHT}
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop offset="0%" stopColor="rgb(var(--destructive))" />
                        <stop
                          offset={`${gradientTransitionStart}%`}
                          stopColor="rgb(var(--destructive))"
                        />
                        <stop
                          offset={`${gradientTransitionEnd}%`}
                          stopColor="rgb(var(--primary))"
                        />
                        <stop offset="100%" stopColor="rgb(var(--primary))" />
                      </linearGradient>
                      <linearGradient
                        id={`${gradientId}-area`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2={SPARKLINE_HEIGHT}
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop offset="0%" stopColor="rgb(var(--destructive))" stopOpacity={0.15} />
                        <stop
                          offset={`${gradientTransitionStart}%`}
                          stopColor="rgb(var(--destructive))"
                          stopOpacity={0.15}
                        />
                        <stop
                          offset={`${gradientTransitionEnd}%`}
                          stopColor="rgb(var(--primary))"
                          stopOpacity={0.15}
                        />
                        <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0.15} />
                      </linearGradient>
                    </defs>
                  )}
                  <path
                    d={sparkline.area}
                    fill={threshold !== undefined ? `url(#${gradientId}-area)` : 'currentColor'}
                    className={threshold !== undefined ? '' : 'text-emerald-300/15'}
                  />
                  {threshold !== undefined && (
                    <line
                      x1={Y_AXIS_LABEL_WIDTH}
                      x2={SPARKLINE_WIDTH}
                      y1={(SPARKLINE_HEIGHT * thresholdOffsetPct) / 100}
                      y2={(SPARKLINE_HEIGHT * thresholdOffsetPct) / 100}
                      stroke="var(--alpha-16)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path
                    d={sparkline.line}
                    fill="none"
                    stroke={threshold !== undefined ? `url(#${gradientId}-line)` : 'currentColor'}
                    strokeWidth={2}
                    className={threshold !== undefined ? '' : 'text-emerald-300'}
                  />
                </svg>
                {threshold !== undefined && (
                  <>
                    <span
                      className="pointer-events-none absolute left-0 -translate-y-1/2 text-xs leading-4 text-muted-foreground"
                      style={{ top: `${thresholdOffsetPct}%` }}
                    >
                      {threshold}%
                    </span>
                    <span className="pointer-events-none absolute bottom-0 left-0 text-xs leading-4 text-muted-foreground">
                      0%
                    </span>
                  </>
                )}
                {hover && (
                  <>
                    <div
                      className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[var(--alpha-16)]"
                      style={{ left: `${hoverLeftPct}%` }}
                    />
                    <div
                      className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
                      style={{ left: `${hoverLeftPct}%`, top: `${hoverTopPct}%` }}
                    />
                    <div
                      className="pointer-events-none absolute -top-1 z-10 whitespace-nowrap rounded border border-[var(--alpha-8)] bg-toast px-2 py-1 text-xs leading-4 shadow"
                      style={{
                        left: `${hoverLeftPct}%`,
                        transform: `translate(${tooltipTranslateX}, -100%)`,
                      }}
                    >
                      <div
                        className={`font-medium ${
                          threshold === undefined
                            ? 'text-foreground'
                            : hover.value > threshold
                              ? 'text-destructive'
                              : 'text-primary'
                        }`}
                      >
                        {formatValue(hover.value)}
                      </div>
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
            <div className="relative h-4 text-xs leading-4 text-muted-foreground">
              {threshold === undefined && <span className="absolute left-0">{xAxisTicks[0]}</span>}
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
