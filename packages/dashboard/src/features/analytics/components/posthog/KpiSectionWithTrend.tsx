import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, LoadingState } from '#components';
import { ErrorState } from '#components/ErrorState';
import type { PosthogWebOverviewItem } from '@insforge/shared-schemas';
import { useTimeframe } from '#features/analytics/context/TimeRangeContext';
import { useWebOverview } from '#features/analytics/hooks/useWebOverview';
import { useTrend } from '#features/analytics/hooks/useTrend';
import type { TrendMetric } from '#features/analytics/services/analytics.service';
import {
  formatNumber,
  formatPercent,
  webOverviewLabel,
  webOverviewValue,
} from '#features/analytics/lib/format';

const TABS: TrendMetric[] = ['visitors', 'views', 'bounce_rate'];

interface KpiTabProps {
  metric: TrendMetric;
  item: PosthogWebOverviewItem | undefined;
  active: boolean;
  onClick: () => void;
}

function KpiTab({ metric, item, active, onClick }: KpiTabProps) {
  const label = webOverviewLabel(metric);
  const display = item ? webOverviewValue(metric, item.value) : '—';
  const pct = item?.changeFromPreviousPct ?? null;
  const showDelta = pct !== null && Number.isFinite(pct);
  const isFlat = (pct ?? 0) === 0;
  const goingUp = (pct ?? 0) > 0;
  const isIncreaseBad = item?.isIncreaseBad === true;
  const goodDirection = goingUp !== isIncreaseBad;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-1 flex-col items-start gap-1 rounded p-3 text-left transition-colors ${
        active ? 'bg-alpha-4' : 'hover:bg-alpha-4'
      }`}
    >
      <span className="text-[13px] leading-[22px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[20px] font-medium leading-7 text-foreground">{display}</span>
        {showDelta && (
          <span
            className={`text-xs ${
              isFlat ? 'text-muted-foreground' : goodDirection ? 'text-primary' : 'text-destructive'
            }`}
          >
            {isFlat ? '→' : goingUp ? '↑' : '↓'} {formatPercent(Math.abs(pct ?? 0))}
          </span>
        )}
      </span>
    </button>
  );
}

function formatXAxis(date: string, timeframe: string): string {
  // YYYY-MM-DD strings get parsed as UTC midnight by new Date(), then
  // toLocaleDateString shifts them back by the local timezone offset — in
  // UTC-N timezones a 2026-05-22 bucket renders as 5/21. Parse date-only
  // strings as local components instead. Datetimes (24h timeframe) still
  // fall through to the standard parser so UTC-to-local conversion stays.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return date;
  }
  if (timeframe === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit' });
  }
  if (timeframe === '3m') {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

function formatY(metric: TrendMetric, value: number): string {
  if (metric === 'bounce_rate') {
    return `${Math.round(value * 100)}%`;
  }
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }
  return String(value);
}

function formatTooltipValue(metric: TrendMetric, value: number): string {
  if (metric === 'bounce_rate') {
    return `${(value * 100).toFixed(1)}%`;
  }
  return formatNumber(value);
}

export function KpiSectionWithTrend({ enabled }: { enabled: boolean }) {
  const timeframe = useTimeframe();
  const overview = useWebOverview(timeframe, enabled);
  const [active, setActive] = useState<TrendMetric>('visitors');
  const trend = useTrend(active, timeframe, enabled);

  const itemsByKey = useMemo(() => {
    const map = new Map<string, PosthogWebOverviewItem>();
    if (overview.data?.items) {
      for (const it of overview.data.items) {
        map.set(it.key, it);
      }
    }
    return map;
  }, [overview.data]);

  const chartData = useMemo(() => {
    if (!trend.data?.series) {
      return [];
    }
    return trend.data.series.map((p) => ({
      date: p.date,
      label: formatXAxis(p.date, timeframe),
      count: p.count,
    }));
  }, [trend.data, timeframe]);

  const yDomain: [number | string, number | string] =
    active === 'bounce_rate' ? [0, 1] : [0, 'auto'];
  const tooltipLabel = webOverviewLabel(active);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card">
      <div className="flex gap-3 p-3">
        {TABS.map((metric) => (
          <KpiTab
            key={metric}
            metric={metric}
            item={itemsByKey.get(metric)}
            active={active === metric}
            onClick={() => setActive(metric)}
          />
        ))}
      </div>
      <div className="h-[260px] p-4">
        {trend.isLoading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingState className="py-0" />
          </div>
        ) : trend.error ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="w-full max-w-[420px]">
              <ErrorState title="Failed to load trend" error="Please try again." />
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="No data available" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="kpi-trend-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--muted-foreground) / 0.2)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={48}
                domain={yDomain}
                tickFormatter={(v) => formatY(active, v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--card))',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'rgb(var(--foreground))',
                }}
                labelStyle={{ color: 'rgb(var(--foreground))' }}
                itemStyle={{ color: 'rgb(var(--foreground))' }}
                formatter={(value) => [formatTooltipValue(active, Number(value)), tooltipLabel]}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="rgb(var(--primary))"
                strokeWidth={2}
                fill="url(#kpi-trend-fill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
