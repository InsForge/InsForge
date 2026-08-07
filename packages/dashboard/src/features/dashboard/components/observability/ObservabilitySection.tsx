import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { useProjectMetrics } from '#features/dashboard/hooks/useProjectMetrics';
import { aggregateMetricSeries } from '#features/dashboard/utils/aggregateMetricSeries';
import type { DashboardMetricName, DashboardMetricsRange } from '#types';
import { ProjectSettingsMenuDialog } from '#features/dashboard/components';
import { MetricChartCard } from './MetricChartCard';

const RANGES: DashboardMetricsRange[] = ['1h', '6h', '24h', '3d'];

/**
 * Memory advisory trigger, as the average over the visible window. A dedicated
 * Postgres instance parked high on memory is its healthy steady state (idle RAM
 * becomes query cache), but it reads as a leak — support keeps fielding
 * "my idle database sits at ~78% memory" reports. 75 is low enough to be seen
 * BEFORE a small instance tips into OOM kills, and below the chart's own 85%
 * red-line so the reassurance arrives ahead of the alarm color.
 */
const MEMORY_ADVISORY_PCT = 75;

const RANGE_SECONDS: Record<DashboardMetricsRange, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '3d': 259200,
};

interface MetricConfig {
  metric: DashboardMetricName;
  i18nKey: string;
  title: string;
  icon: React.ReactNode;
  format: (value: number) => string;
  threshold?: number;
  description: string;
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
    i18nKey: 'cpuUsage',
    title: 'CPU Usage',
    icon: <Cpu className="h-5 w-5" />,
    format: PERCENT,
    threshold: 60,
    description:
      "How hard your instance's processor is working. Sustained high usage slows down API requests and background jobs.",
  },
  {
    metric: 'memory_usage',
    i18nKey: 'memoryUsage',
    title: 'Memory Usage',
    icon: <MemoryStick className="h-5 w-5" />,
    format: PERCENT,
    threshold: 85,
    description:
      "How much of your instance's RAM is in use. When memory runs low, processes can be killed or start swapping, which hurts performance.",
  },
  {
    metric: 'network_in',
    i18nKey: 'networkIn',
    title: 'Network In',
    icon: <ArrowDownToLine className="h-5 w-5" />,
    format: BYTES_PER_SEC,
    description:
      'Rate of data flowing into your instance, such as file uploads and incoming API requests.',
  },
  {
    metric: 'network_out',
    i18nKey: 'networkOut',
    title: 'Network Out',
    icon: <ArrowUpFromLine className="h-5 w-5" />,
    format: BYTES_PER_SEC,
    description:
      'Rate of data leaving your instance, such as query results and file downloads served to clients.',
  },
];

// Disk card slot in the grid (after CPU + Memory, before Network).
const DISK_GRID_INDEX = 2;

export function ObservabilitySection() {
  const { t } = useTranslation('chrome');
  const isCloudHostingMode = useIsCloudHostingMode();
  const [range, setRange] = useState<DashboardMetricsRange>('1h');
  const [computeSettingsOpen, setComputeSettingsOpen] = useState(false);
  const { data, isLoading, isUnavailable, error } = useProjectMetrics(range);

  const memoryAdvisoryAvg = useMemo(() => {
    const series = data?.metrics.find((m) => m.metric === 'memory_usage')?.data ?? [];
    const avg = aggregateMetricSeries(series).avg;
    return avg !== null && avg >= MEMORY_ADVISORY_PCT ? avg : null;
  }, [data]);

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
        <h2 className="text-xl font-medium leading-7 text-foreground">
          {t('overview.observability', { defaultValue: 'Observability' })}
        </h2>
        <div
          role="group"
          aria-label={t('overview.timeRange', { defaultValue: 'Time range' })}
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
          {t('overview.metricsUnavailable', {
            defaultValue: 'Metrics unavailable for this instance',
          })}
        </div>
      ) : error ? (
        <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card text-sm text-destructive">
          {t('overview.metricsLoadFailed', {
            defaultValue: 'Failed to load metrics. Please try again.',
          })}
        </div>
      ) : (
        <>
          {memoryAdvisoryAvg !== null && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--alpha-8)] bg-card p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] text-muted-foreground">
                  <MemoryStick className="h-5 w-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-medium leading-5 text-foreground">
                    {t('overview.memoryAdvisory.title', {
                      value: PERCENT(memoryAdvisoryAvg),
                      defaultValue: 'Memory averaging {{value}} — usually normal.',
                    })}
                  </p>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {t('overview.memoryAdvisory.description', {
                      defaultValue:
                        'A dedicated Postgres database turns idle RAM into query cache, so steady high memory is expected on its own. On smaller instances real load can still tip it into out-of-memory kills — if you see restarts or slowdowns, move to a larger instance for headroom.',
                    })}
                  </p>
                </div>
              </div>
              {isCloudHostingMode && (
                <Button
                  type="button"
                  className="h-8 shrink-0 rounded px-3 text-sm font-medium"
                  onClick={() => setComputeSettingsOpen(true)}
                >
                  {t('overview.memoryAdvisory.cta', { defaultValue: 'Upgrade Instance' })}
                </Button>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(() => {
              const cards = METRICS.map((config) => {
                const series = data?.metrics.find((m) => m.metric === config.metric);
                return (
                  <MetricChartCard
                    key={config.metric}
                    title={t(`overview.metrics.${config.i18nKey}.title`, {
                      defaultValue: config.title,
                    })}
                    icon={config.icon}
                    data={series?.data ?? []}
                    rangeSeconds={RANGE_SECONDS[range]}
                    formatValue={config.format}
                    isLoading={isLoading}
                    threshold={config.threshold}
                    description={t(`overview.metrics.${config.i18nKey}.description`, {
                      defaultValue: config.description,
                    })}
                  />
                );
              });

              cards.splice(
                DISK_GRID_INDEX,
                0,
                <MetricChartCard
                  key="disk_used"
                  title={t('overview.metrics.diskUsed.title', { defaultValue: 'Disk Usage' })}
                  icon={<HardDrive className="h-5 w-5" />}
                  data={diskCardProps.data}
                  rangeSeconds={RANGE_SECONDS[range]}
                  formatValue={BYTES_SIZE}
                  isLoading={isLoading}
                  threshold={diskCardProps.threshold}
                  fixedDomain={diskCardProps.fixedDomain}
                  formatAxisLabel={BYTES_SIZE}
                  description={t('overview.metrics.diskUsed.description', {
                    defaultValue:
                      "How much of your instance's storage the database, files, and logs are using. A full disk stops writes and can take the backend offline.",
                  })}
                />
              );
              return cards;
            })()}
          </div>
        </>
      )}
      {/* The CTA lands on the settings dialog's Compute tab because that tab is
          already the tier-aware surface: a free plan sees the Upgrade Plan
          upsell, a paid plan picks a larger instance type. */}
      <ProjectSettingsMenuDialog
        open={computeSettingsOpen}
        onOpenChange={setComputeSettingsOpen}
        defaultTab="compute"
      />
    </section>
  );
}
