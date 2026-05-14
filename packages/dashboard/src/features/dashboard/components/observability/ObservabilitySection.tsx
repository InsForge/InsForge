import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useProjectMetrics } from '#features/dashboard/hooks/useProjectMetrics';
import type { DashboardMetricName, DashboardMetricsRange } from '#types';
import { MetricChartCard } from './MetricChartCard';

const RANGES: DashboardMetricsRange[] = ['1h', '6h', '24h', '3d'];

const RANGE_SECONDS: Record<DashboardMetricsRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '3d': 259200,
};

interface MetricConfig {
  metric: DashboardMetricName;
  title: string;
  icon: React.ReactNode;
  format: (value: number) => string;
  threshold?: number;
}

const PERCENT = (value: number) => `${value.toFixed(1)}%`;
const BYTES_PER_SEC = (value: number) => {
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};
const BYTES_SIZE = (value: number) => {
  if (value === 0) {
    return '0 bytes';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

const METRICS: MetricConfig[] = [
  {
    metric: 'cpu_usage',
    title: 'CPU Usage',
    icon: <Cpu className="h-5 w-5" />,
    format: PERCENT,
    threshold: 60,
  },
  {
    metric: 'memory_usage',
    title: 'Memory Usage',
    icon: <MemoryStick className="h-5 w-5" />,
    format: PERCENT,
    threshold: 85,
  },
  {
    metric: 'network_in',
    title: 'Network In',
    icon: <ArrowDownToLine className="h-5 w-5" />,
    format: BYTES_PER_SEC,
  },
  {
    metric: 'network_out',
    title: 'Network Out',
    icon: <ArrowUpFromLine className="h-5 w-5" />,
    format: BYTES_PER_SEC,
  },
];

// Disk card slot in the grid (after CPU + Memory, before Network).
const DISK_GRID_INDEX = 2;

export function ObservabilitySection() {
  const [range, setRange] = useState<DashboardMetricsRange>('1h');
  const { data, isLoading, isUnavailable, error } = useProjectMetrics(range);

  // Memoize disk card derivations so the [0, totalBytes] domain array reference
  // is stable across renders — otherwise MetricChartCard's sparkline useMemo
  // re-runs every parent render.
  const diskCardProps = useMemo(() => {
    const diskUsedData = data?.metrics.find((m) => m.metric === 'disk_used')?.data ?? [];
    const diskTotalData = data?.metrics.find((m) => m.metric === 'disk_total')?.data ?? [];
    const totalBytes =
      [...diskTotalData].reverse().find((p) => Number.isFinite(p.value))?.value ?? null;
    return {
      data: diskUsedData,
      threshold: totalBytes !== null ? 0.9 * totalBytes : undefined,
      fixedDomain: (totalBytes !== null ? [0, totalBytes] : undefined) as
        | [number, number]
        | undefined,
    };
  }, [data]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-medium leading-7 text-foreground">Observability</h2>
        <div
          role="group"
          aria-label="Time range"
          className="flex items-center overflow-hidden rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)]"
        >
          {RANGES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={`flex items-center px-3 py-1.5 text-sm leading-5 transition-colors ${
                range === value
                  ? 'bg-toast text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {isUnavailable ? (
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card text-sm text-muted-foreground">
          Metrics unavailable for this instance
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card text-sm text-destructive">
          Failed to load metrics. Please try again.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(() => {
            const cards = METRICS.map((config) => {
              const series = data?.metrics.find((m) => m.metric === config.metric);
              return (
                <MetricChartCard
                  key={config.metric}
                  title={config.title}
                  icon={config.icon}
                  data={series?.data ?? []}
                  rangeSeconds={RANGE_SECONDS[range]}
                  formatValue={config.format}
                  isLoading={isLoading}
                  threshold={config.threshold}
                />
              );
            });

            cards.splice(
              DISK_GRID_INDEX,
              0,
              <MetricChartCard
                key="disk_used"
                title="Disk Usage"
                icon={<HardDrive className="h-5 w-5" />}
                data={diskCardProps.data}
                rangeSeconds={RANGE_SECONDS[range]}
                formatValue={BYTES_SIZE}
                isLoading={isLoading}
                threshold={diskCardProps.threshold}
                fixedDomain={diskCardProps.fixedDomain}
                formatAxisLabel={BYTES_SIZE}
              />
            );
            return cards;
          })()}
        </div>
      )}
    </section>
  );
}
