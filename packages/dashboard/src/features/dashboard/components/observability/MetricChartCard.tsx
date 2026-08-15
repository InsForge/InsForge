import { type MouseEventHandler, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '#components';
import type { DashboardMetricDataPoint } from '#types';
import { aggregateMetricSeries } from '#features/dashboard/utils/aggregateMetricSeries';

export interface MetricChartCardProps {
  title: string;
  icon: ReactNode;
  data: DashboardMetricDataPoint[];
  rangeSeconds: number;
  formatValue: (value: number) => string;
  isLoading?: boolean;
  /** Value (in data units) at which the threshold dashed line is drawn. */
  threshold?: number;
  /** Fixed y-axis domain [min, max]. Defaults to [0, 100] when threshold is set, else auto-fits to data. */
  fixedDomain?: [number, number];
  /** Formatter for axis labels (threshold + zero). Defaults to `${v}%`. */
  formatAxisLabel?: (value: number) => string;
  /** Short explanation of the metric, surfaced via an info tooltip next to the title. */
  description?: string;
  /**
   * Capacity chart: samples drawn as bars against a fixed domain. Without
   * `components` this is the single-color fallback — dashed ceiling line at
   * the domain top, byte-labeled ticks, legend row under the chart. With
   * `components` it follows the Figma disk design (node 3579:68356): stacked
   * bars, dotted reference ticks (no ceiling line), legend chips in the
   * header. Only meaningful with `fixedDomain`; replaces the area/line
   * rendering.
   */
  capacity?: {
    ticks: number[];
    legend: { ceiling: string; used: string };
    /**
     * Stacked composition series (bottom-up render order, which is also the
     * header legend order). When present the bars stack these instead of
     * drawing the primary series, giving the System/WAL/Database breakdown;
     * all series come from one sampler so they share timestamps.
     */
    components?: Array<{
      key: string;
      label: string;
      fillClass: string;
      data: DashboardMetricDataPoint[];
    }>;
    /** Component rows for the hovered moment; null hides the row block. */
    tooltipRows?: (
      timestamp: number
    ) => Array<{ label: string; value: string; swatchClass?: string }> | null;
  };
  /** Extra tooltip line under the value, e.g. the value as a share of the ceiling. */
  tooltipDetail?: (value: number) => string;
  /**
   * Draw the primary series as bars instead of a line/area (the Figma
   * observability look). With a threshold, bars above it turn destructive
   * while the dashed threshold line stays.
   */
  barChart?: boolean;
  /**
   * Raw readings for AVG/MAX/LATEST and the headline timestamp when `data`
   * has been densified for rendering (slot forward-fill) — stats over the
   * densified series would be slot-weighted artifacts. Defaults to `data`.
   */
  statsData?: DashboardMetricDataPoint[];
}

const SPARKLINE_WIDTH = 434;
const SPARKLINE_HEIGHT = 100;
// Figma reserves 29px on the left for the y-axis labels (e.g. "85%"), so the
// threshold dashed line and reference grid start after them.
const Y_AXIS_LABEL_WIDTH = 29;

/** Bar width for `count` samples sharing the plot. */
function barWidthFor(count: number): number {
  const slot = (SPARKLINE_WIDTH - Y_AXIS_LABEL_WIDTH) / Math.max(1, count);
  return Math.max(1.5, slot * 0.85);
}

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

/**
 * Map a timestamp onto the chart's x axis.
 *
 * `plotRange` is the span samples may occupy. It defaults to the whole width,
 * which is what the line/area variant wants: no y-axis gutter to clear, and the
 * stroke should reach both edges.
 *
 * The single-color capacity fallback passes its bar region instead. Mapping into
 * the region matters because clamping into it does not relocate a sample that
 * lands in the gutter, it pins every such sample to the same x.
 */
function timestampToX(
  timestamp: number,
  windowStart: number,
  tRange: number,
  plotRange: [number, number]
): number {
  const [left, right] = plotRange;
  const progress = (timestamp - windowStart) / tRange;
  return left + Math.max(0, Math.min(1, progress)) * (right - left);
}

function buildSparkline(
  data: DashboardMetricDataPoint[],
  rangeSeconds: number,
  fixedDomain?: [number, number],
  plotRange: [number, number] = [0, SPARKLINE_WIDTH]
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
    const x = timestampToX(p.timestamp, windowStart, tRange, plotRange);
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
  fixedDomain,
  formatAxisLabel,
  description,
  capacity,
  tooltipDetail,
  barChart,
  statsData,
}: MetricChartCardProps) {
  const { t } = useTranslation('chrome');
  const effectiveDomain =
    fixedDomain ?? (threshold !== undefined ? FIXED_PERCENT_DOMAIN : undefined);
  // Aggregates and the headline timestamp come from the RAW readings when the
  // chart data has been densified into slots — a forward-filled series would
  // turn AVG into a slot-weighted artifact of the densification pass.
  const statsSeries = statsData ?? data;
  const aggregates = useMemo(() => aggregateMetricSeries(statsSeries), [statsSeries]);
  // The single-color capacity fallback keeps timestamp-proportional placement,
  // so its samples have to be mapped into the bar region rather than clamped
  // into it by `bars` below. Bars are centered on the sample x, hence the half
  // width of inset on each side: that makes the clamp there a true no-op.
  const fallbackPlotRange = useMemo((): [number, number] | undefined => {
    if (!capacity || capacity.components?.length || barChart) {
      return undefined;
    }
    const count = data.filter((p) => Number.isFinite(p.value)).length;
    if (count < 2) {
      return undefined;
    }
    const width = barWidthFor(count);
    return [Y_AXIS_LABEL_WIDTH + 2 + width / 2, SPARKLINE_WIDTH - width / 2];
  }, [capacity, barChart, data]);
  const sparkline = useMemo(
    () => buildSparkline(data, rangeSeconds, effectiveDomain, fallbackPlotRange),
    [data, rangeSeconds, effectiveDomain, fallbackPlotRange]
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

  // Timestamp of the newest sample, under the headline (Supabase-style): the
  // big number is a reading at a moment, not a live gauge, and saying which
  // moment stops "why doesn't it move?" confusion on slow-scrape metrics.
  const latestTimestamp = useMemo(() => {
    let latest: number | null = null;
    for (const point of statsSeries) {
      if (Number.isFinite(point.value) && (latest === null || point.timestamp > latest)) {
        latest = point.timestamp;
      }
    }
    return latest;
  }, [statsSeries]);

  // Sparse or uneven series make timestamp-proportional bars bunch up with
  // erratic gaps, so the stacked-breakdown and barChart modes give each
  // sample an equal slot across the full plot width; hover targeting and the
  // dot follow the same remapped x so they stay centered on the bars. The
  // single-color capacity fallback (self-host, older backend) keeps its
  // timestamp-proportional placement — its x-axis labels describe real time.
  const displayPoints = useMemo(() => {
    const uniform = capacity?.components?.length || barChart;
    if (!uniform || sparkline.points.length === 0) {
      return sparkline.points;
    }
    const slot = (SPARKLINE_WIDTH - Y_AXIS_LABEL_WIDTH) / sparkline.points.length;
    return sparkline.points.map((point, i) => ({
      ...point,
      x: Y_AXIS_LABEL_WIDTH + slot * (i + 0.5),
    }));
  }, [capacity, barChart, sparkline.points]);

  const handleMove: MouseEventHandler<SVGSVGElement> = (e) => {
    const svg = svgRef.current;
    if (!svg || displayPoints.length === 0) {
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const vbX = ((e.clientX - rect.left) / rect.width) * SPARKLINE_WIDTH;
    let bestIdx = 0;
    let bestDist = Math.abs(displayPoints[0].x - vbX);
    for (let i = 1; i < displayPoints.length; i++) {
      const d = Math.abs(displayPoints[i].x - vbX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    setHoverIdx(bestIdx);
  };

  const handleLeave = () => setHoverIdx(null);

  // Single-color bar variants: the capacity fallback and the barChart mode
  // both draw the primary series as one bar per sample, centered in the
  // displayPoints slots so bars, hover dot and hit-testing share an x.
  const bars = useMemo(() => {
    const active = barChart || (capacity && !capacity.components?.length);
    if (!active || displayPoints.length === 0) {
      return [];
    }
    const width = barWidthFor(displayPoints.length);
    // Both variants now arrive pre-fitted to the plot: barChart via uniform
    // slots, the capacity fallback via fallbackPlotRange. The clamp stays as a
    // backstop against rounding at the edges, but it no longer decides
    // placement, which is what made it collapse the oldest bars.
    return displayPoints.map((point) => ({
      x: Math.max(Y_AXIS_LABEL_WIDTH + 2, Math.min(point.x - width / 2, SPARKLINE_WIDTH - width)),
      y: point.y,
      width,
      height: Math.max(1.5, SPARKLINE_HEIGHT - point.y),
      value: point.value,
    }));
  }, [capacity, barChart, displayPoints]);

  // Stacked composition bars: segments accumulate bottom-up per shared sample
  // timestamp. Bars sit in equal slots across the plot (matching
  // displayPoints) rather than at timestamp-proportional x — the sampler's
  // cadence is coarse and uneven, and proportional placement reads as broken
  // spacing rather than as a time axis.
  const stackedBars = useMemo(() => {
    const components = capacity?.components;
    if (!components?.length) {
      return [];
    }
    const [min, max] = effectiveDomain ?? [0, 100];
    const valueRange = max - min || 1;
    const base = components[0].data;
    const slot = (SPARKLINE_WIDTH - Y_AXIS_LABEL_WIDTH) / Math.max(1, base.length);
    const width = Math.max(2, slot * 0.85);

    return base.map((point, i) => {
      const x = Y_AXIS_LABEL_WIDTH + slot * (i + 0.5) - width / 2;
      let cumulative = 0;
      const segments = components.map((component) => {
        const value = component.data[i]?.value ?? 0;
        const y0 = cumulative;
        cumulative += value;
        const yTop = SPARKLINE_HEIGHT - ((cumulative - min) / valueRange) * SPARKLINE_HEIGHT;
        const yBottom = SPARKLINE_HEIGHT - ((y0 - min) / valueRange) * SPARKLINE_HEIGHT;
        return {
          key: component.key,
          fillClass: component.fillClass,
          y: yTop,
          height: Math.max(value > 0 ? 1 : 0, yBottom - yTop),
        };
      });
      return { x, width, timestamp: point.timestamp, segments };
    });
  }, [capacity, effectiveDomain]);

  const hover = hoverIdx !== null ? (displayPoints[hoverIdx] ?? null) : null;
  const hoverLeftPct = hover ? (hover.x / SPARKLINE_WIDTH) * 100 : 0;
  const hoverTopPct = hover ? (hover.y / SPARKLINE_HEIGHT) * 100 : 0;
  const tooltipTranslateX = hoverLeftPct < 15 ? '0%' : hoverLeftPct > 85 ? '-100%' : '-50%';

  const [domainMin, domainMax] = effectiveDomain ?? [0, 100];
  const domainRange = domainMax - domainMin || 1;
  const thresholdOffsetPct =
    threshold !== undefined ? 100 - ((threshold - domainMin) / domainRange) * 100 : 0;
  const renderAxisLabel = (value: number) =>
    formatAxisLabel ? formatAxisLabel(value) : `${value}%`;
  const thresholdNote =
    threshold !== undefined
      ? barChart
        ? t('overview.thresholdNoteBars', {
            threshold: renderAxisLabel(threshold),
            defaultValue: 'Green while healthy; bars turn red above {{threshold}}.',
          })
        : t('overview.thresholdNote', {
            threshold: renderAxisLabel(threshold),
            defaultValue: 'Green while healthy; the line turns red above {{threshold}}.',
          })
      : null;
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
    // No overflow-hidden on the card: the hover tooltip must be able to
    // escape the chart area without being clipped at the card edge.
    <div className="flex flex-col rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5 text-[13px] leading-[22px] text-muted-foreground">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
          <span className="truncate">{title}</span>
          {description && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t('overview.aboutMetric', { title, defaultValue: 'About {{title}}' })}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-auto max-w-[260px] rounded border-[var(--border)] bg-[rgb(var(--foreground))] p-2 text-left text-xs font-normal normal-case leading-4 text-[rgb(var(--inverse))] shadow-[0_4px_4px_rgba(0,0,0,0.08)]"
              >
                <p>{description}</p>
                {thresholdNote && <p className="mt-1">{thresholdNote}</p>}
              </PopoverContent>
            </Popover>
          )}
          {/* Breakdown legend lives in the header (Figma 3579:68356): a
              square chip per stacked component, in stack order. */}
          {capacity?.components?.length ? (
            <span className="ml-auto flex shrink-0 items-center gap-3 pl-2">
              {capacity.components.map((component) => (
                <span key={component.key} className="flex items-center gap-1 text-xs leading-4">
                  <span
                    aria-hidden
                    className={`h-3 w-3 ${component.fillClass.replace('fill-', 'bg-')}`}
                  />
                  <span className="whitespace-nowrap text-foreground">{component.label}</span>
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col">
          <p className="text-[20px] font-medium leading-7 text-foreground">
            {isLoading ? '—' : renderValue(aggregates.latest)}
          </p>
          {!isLoading && latestTimestamp !== null && (
            <p className="text-xs leading-4 text-muted-foreground">
              {new Date(latestTimestamp * 1000).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
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
                  {!capacity && !barChart && (
                    <path
                      d={sparkline.area}
                      fill={threshold !== undefined ? `url(#${gradientId}-area)` : 'currentColor'}
                      className={threshold !== undefined ? '' : 'text-emerald-300/15'}
                    />
                  )}
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
                  {capacity &&
                    capacity.ticks.map((tick) => {
                      const yPct = 1 - (tick - domainMin) / domainRange;
                      const y = Math.max(
                        1,
                        Math.min(SPARKLINE_HEIGHT - 1, yPct * SPARKLINE_HEIGHT)
                      );
                      const isCeiling = tick === domainMax;
                      // Breakdown mode (Figma 3579:68356): reference ticks
                      // above the floor are dotted, and there is no ceiling
                      // line — the chart top is simply 100% of the disk.
                      const dotted = capacity.components?.length && tick > domainMin;
                      return (
                        <line
                          key={tick}
                          x1={Y_AXIS_LABEL_WIDTH}
                          x2={SPARKLINE_WIDTH}
                          y1={y}
                          y2={y}
                          stroke={isCeiling || dotted ? 'var(--alpha-16)' : 'var(--alpha-8)'}
                          strokeWidth={1}
                          strokeDasharray={dotted ? '1 3' : isCeiling ? '4 3' : undefined}
                          vectorEffect="non-scaling-stroke"
                        />
                      );
                    })}
                  {!capacity && !barChart && (
                    <path
                      d={sparkline.line}
                      fill="none"
                      stroke={threshold !== undefined ? `url(#${gradientId}-line)` : 'currentColor'}
                      strokeWidth={2}
                      className={threshold !== undefined ? '' : 'text-emerald-300'}
                    />
                  )}
                  {bars.map((bar, i) => (
                    <rect
                      key={i}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      className={
                        threshold !== undefined && bar.value > threshold
                          ? 'fill-[rgb(var(--destructive))]'
                          : 'fill-emerald-300'
                      }
                    />
                  ))}
                  {/* Key by slot index: densified slots forward-fill the same
                      source timestamp across many bars, so timestamps are NOT
                      unique here. */}
                  {stackedBars.map((bar, barIdx) => (
                    <g key={barIdx}>
                      {bar.segments.map((segment) =>
                        segment.height > 0 ? (
                          <rect
                            key={segment.key}
                            x={bar.x}
                            y={segment.y}
                            width={bar.width}
                            height={segment.height}
                            className={segment.fillClass}
                          />
                        ) : null
                      )}
                    </g>
                  ))}
                </svg>
                {/* Threshold cards label the full domain (100% / 0%); the
                    dashed threshold line stays but carries no label of its
                    own — an 85% at the top edge read as the chart's upper
                    bound. */}
                {threshold !== undefined && (
                  <>
                    <span className="pointer-events-none absolute left-0 top-0 text-xs leading-4 text-muted-foreground">
                      {renderAxisLabel(domainMax)}
                    </span>
                    <span className="pointer-events-none absolute bottom-0 left-0 text-xs leading-4 text-muted-foreground">
                      {renderAxisLabel(domainMin)}
                    </span>
                  </>
                )}
                {capacity &&
                  capacity.ticks.map((tick) => {
                    const yPct = (1 - (tick - domainMin) / domainRange) * 100;
                    const atTop = tick === domainMax;
                    const atBottom = tick === domainMin;
                    // The floor label hangs BELOW the chart line, in the
                    // x-axis row's empty left slot — byte labels like
                    // "4.0 GB" are wider than the gutter and would sit on
                    // top of the first bars otherwise.
                    return (
                      <span
                        key={tick}
                        className={`pointer-events-none absolute left-0 text-xs leading-4 text-muted-foreground ${
                          atTop || atBottom ? '' : '-translate-y-1/2'
                        }`}
                        style={{ top: `${Math.max(0, Math.min(100, yPct))}%` }}
                      >
                        {renderAxisLabel(tick)}
                      </span>
                    );
                  })}
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
                    {/* The tooltip drops BELOW the hover dot: anchored upward
                        it reaches past the card top and turns unreadable near
                        the viewport edge while scrolling. */}
                    <div
                      className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-[var(--alpha-16)] bg-card px-2.5 py-1.5 text-xs leading-4 text-foreground shadow-lg"
                      style={{
                        left: `${hoverLeftPct}%`,
                        top: `calc(${hoverTopPct}% + 12px)`,
                        transform: `translate(${tooltipTranslateX}, 0)`,
                      }}
                    >
                      {/* Always white — a green/red hover value reads as a
                          verdict, and the chart already carries the
                          threshold signal. */}
                      <div className="font-medium text-foreground">{formatValue(hover.value)}</div>
                      {tooltipDetail && (
                        <div className="text-muted-foreground">{tooltipDetail(hover.value)}</div>
                      )}
                      {capacity?.tooltipRows &&
                        (() => {
                          const rows = capacity.tooltipRows(hover.timestamp);
                          if (!rows?.length) {
                            return null;
                          }
                          return (
                            <div className="mt-1 flex flex-col gap-0.5 border-t border-[var(--alpha-8)] pt-1">
                              {rows.map((row) => (
                                <div
                                  key={row.label}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="flex items-center gap-1.5 text-muted-foreground">
                                    {row.swatchClass && (
                                      <span
                                        className={`h-1.5 w-1.5 rounded-full ${row.swatchClass}`}
                                      />
                                    )}
                                    {row.label}
                                  </span>
                                  <span className="tabular-nums text-foreground">{row.value}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      <div className="text-muted-foreground">
                        {formatHoverTime(hover.timestamp, rangeSeconds)}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[13px] text-muted-foreground">
                {isLoading
                  ? t('overview.loadingShort', { defaultValue: 'Loading…' })
                  : t('overview.noData', { defaultValue: 'No data' })}
              </div>
            )}
          </div>
          {sparkline.line && (
            <div className="relative h-4 text-xs leading-4 text-muted-foreground">
              {threshold === undefined && !capacity && (
                <span className="absolute left-0">{xAxisTicks[0]}</span>
              )}
              <span className="absolute left-1/2 -translate-x-1/2">{xAxisTicks[1]}</span>
              <span className="absolute right-0">{xAxisTicks[2]}</span>
            </div>
          )}
          {/* The under-chart legend belongs to the single-color fallback; the
              breakdown variant carries its legend chips in the header. */}
          {capacity && !capacity.components?.length && sparkline.line && (
            <div className="flex items-center justify-center gap-4 pt-1 text-xs leading-4 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="tracking-[2px]">
                  ···
                </span>
                {capacity.legend.ceiling}
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-300" />
                {capacity.legend.used}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-[var(--alpha-8)]">
        {(['AVG', 'MAX', 'LATEST'] as const).map((label, i) => {
          const statLabel =
            i === 0
              ? t('overview.statAvg', { defaultValue: 'AVG' })
              : i === 1
                ? t('overview.statMax', { defaultValue: 'MAX' })
                : t('overview.statLatest', { defaultValue: 'LATEST' });
          const value = i === 0 ? aggregates.avg : i === 1 ? aggregates.max : aggregates.latest;
          return (
            <div
              key={label}
              className={`flex flex-col items-center justify-center gap-1 py-4 ${
                i < 2 ? 'border-r border-[var(--alpha-8)]' : ''
              }`}
            >
              <span className="text-xs leading-4 text-muted-foreground">{statLabel}</span>
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
