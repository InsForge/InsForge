import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTimeframe } from '../../context/TimeRangeContext';
import { usePageviewsTrend } from '../../hooks/usePageviewsTrend';
import { formatNumber } from '../../lib/format';

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

export function PageviewsTrendChart({ enabled }: { enabled: boolean }) {
  const timeframe = useTimeframe();
  const { data, isLoading, error } = usePageviewsTrend(timeframe, enabled);

  const chartData = useMemo(() => {
    if (!data?.series) {
      return [];
    }
    return data.series.map((p) => ({
      date: p.date,
      label: formatXAxis(p.date, timeframe),
      count: p.count,
    }));
  }, [data, timeframe]);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Pageviews</h3>
      <div className="h-[200px]">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Failed to load trend.
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'currentColor' }}
                className="text-muted-foreground"
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgb(var(--card))',
                  border: '1px solid rgb(var(--border))',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: 'rgb(var(--foreground))' }}
                formatter={(value) => [formatNumber(Number(value)), 'Pageviews']}
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
