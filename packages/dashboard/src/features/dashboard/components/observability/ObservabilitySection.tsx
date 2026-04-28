import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useProjectMetrics } from '../../hooks/useProjectMetrics';
import type { DashboardMetricName, DashboardMetricsRange } from '../../../../types';
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

const METRICS: MetricConfig[] = [
  { metric: 'cpu_usage', title: 'CPU Usage', icon: <Cpu className="h-5 w-5" />, format: PERCENT },
  {
    metric: 'memory_usage',
    title: 'Memory Usage',
    icon: <MemoryStick className="h-5 w-5" />,
    format: PERCENT,
  },
  {
    metric: 'disk_usage',
    title: 'Disk Usage',
    icon: <HardDrive className="h-5 w-5" />,
    format: PERCENT,
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

export function ObservabilitySection() {
  const [range, setRange] = useState<DashboardMetricsRange>('1h');
  const { data, isLoading, isUnavailable, error } = useProjectMetrics(range);

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
          {METRICS.map((config) => {
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
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
