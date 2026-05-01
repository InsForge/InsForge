import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PosthogWebOverviewItem } from '@insforge/shared-schemas';
import { useTimeframe } from '../../context/TimeRangeContext';
import { useWebOverview } from '../../hooks/useWebOverview';
import { useTrend } from '../../hooks/useTrend';
import type { TrendMetric } from '../../services/posthog.api';
import { formatNumber, formatPercent, webOverviewLabel, webOverviewValue } from '../../lib/format';

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
  const goingUp = (pct ?? 0) > 0;
  const isIncreaseBad = item?.isIncreaseBad === true;
  const goodDirection = goingUp !== isIncreaseBad;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`relative flex flex-col gap-1 px-4 py-4 text-left transition-colors ${
        active ? 'bg-card' : 'bg-card/60 hover:bg-card'
      }`}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground">{display}</span>
        {showDelta && (
          <span className={`text-xs ${goodDirection ? 'text-primary' : 'text-destructive'}`}>
            {goingUp ? '↑' : '↓'} {formatPercent(Math.abs(pct ?? 0))}
          </span>
        )}
      </span>
      {active && (
        <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 bg-foreground" />
      )}
    </button>
  );
}

function formatXAxis(date: string, timeframe: string): string {
  const d = new Date(date);
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
    <div className="overflow-hidden rounded-lg bg-card">
      <div className="grid grid-cols-3 divide-x divide-[rgb(var(--muted-foreground)/0.1)]">
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
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : trend.error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Failed to load trend.
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--muted-foreground) / 0.2)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'rgb(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
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
              <Line
                type="monotone"
                dataKey="count"
                stroke="rgb(var(--primary))"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
