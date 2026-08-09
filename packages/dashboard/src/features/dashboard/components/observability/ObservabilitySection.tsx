import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { isInsForgeCloudProject } from '#lib/utils/utils';
import { useProjectMetrics } from '#features/dashboard/hooks/useProjectMetrics';
import { aggregateMetricSeries } from '#features/dashboard/utils/aggregateMetricSeries';
import type { DashboardMetricDataPoint, DashboardMetricName, DashboardMetricsRange } from '#types';
import { ProjectSettingsMenuDialog } from '#features/dashboard/components';
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

/**
 * Assemble the Database/WAL/System stack from the metric series. Database and
 * WAL arrive from the cloud sampler and share timestamps; System is derived
 * per sample as (nearest disk_used) − database − wal, clamped at zero — it is
 * never measured, so it must never be fabricated when the used series has no
 * nearby sample (10-minute tolerance). Returns null when the breakdown series
 * are absent (older cloud backend, self-host) so the card falls back to the
 * single-color capacity chart. Exported for tests.
 */
export function buildDiskBreakdown(
  database: DashboardMetricDataPoint[] | undefined,
  wal: DashboardMetricDataPoint[] | undefined,
  used: DashboardMetricDataPoint[]
): {
  database: DashboardMetricDataPoint[];
  wal: DashboardMetricDataPoint[];
  system: DashboardMetricDataPoint[];
} | null {
  if (!database?.length || !wal?.length) {
    return null;
  }
  const walByTs = new Map(wal.map((p) => [p.timestamp, p.value]));
  const nearestUsed = (ts: number): number | null => {
    let best: DashboardMetricDataPoint | null = null;
    for (const point of used) {
      if (!Number.isFinite(point.value)) {
        continue;
      }
      if (!best || Math.abs(point.timestamp - ts) < Math.abs(best.timestamp - ts)) {
        best = point;
      }
    }
    return best && Math.abs(best.timestamp - ts) <= 600 ? best.value : null;
  };
  const alignedWal: DashboardMetricDataPoint[] = [];
  const system: DashboardMetricDataPoint[] = [];
  const alignedDb: DashboardMetricDataPoint[] = [];
  for (const point of database) {
    const walValue = walByTs.get(point.timestamp);
    if (walValue === undefined) {
      continue;
    }
    alignedDb.push(point);
    alignedWal.push({ timestamp: point.timestamp, value: walValue });
    const usedValue = nearestUsed(point.timestamp);
    system.push({
      timestamp: point.timestamp,
      value: usedValue === null ? 0 : Math.max(0, usedValue - point.value - walValue),
    });
  }
  return alignedDb.length ? { database: alignedDb, wal: alignedWal, system } : null;
}

export function ObservabilitySection() {
  const { t } = useTranslation('chrome');
  const isCloudHostingMode = useIsCloudHostingMode();
  // Same pair of signals the settings dialog gates its Compute tab on
  // (ProjectSettingsMenuDialog's canUseCloudHost) — the CTA must not show
  // when the tab it promises would fall back to Project Information.
  const canOpenComputeSettings = isCloudHostingMode && isInsForgeCloudProject();
  const [range, setRange] = useState<DashboardMetricsRange>('1h');
  const [computeSettingsOpen, setComputeSettingsOpen] = useState(false);
  const { data, isLoading, isUnavailable, error } = useProjectMetrics(range);

  // Always shown (Tony's call, QA 2026-08-07): the reassurance IS the point —
  // a dedicated Postgres instance parked high on memory is its healthy steady
  // state (idle RAM becomes query cache), but it reads as a leak, and support
  // keeps fielding "my idle database sits at ~78% memory" reports. The value is
  // the latest sample, the same number the Memory card's headline shows; only a
  // series with no samples (fresh instance, metrics gap) has nothing to say.
  const memoryAdvisoryPct = useMemo(() => {
    const series = data?.metrics.find((m) => m.metric === 'memory_usage')?.data ?? [];
    return aggregateMetricSeries(series).latest;
  }, [data]);

  // Memoize disk card derivations so the [0, totalBytes] domain array reference
  // is stable across renders — otherwise MetricChartCard's sparkline useMemo
  // re-runs every parent render.
  const diskCardProps = useMemo(() => {
    const diskUsedData = data?.metrics.find((m) => m.metric === 'disk_used')?.data ?? [];
    const diskTotalData = data?.metrics.find((m) => m.metric === 'disk_total')?.data ?? [];
    const totalBytes =
      [...diskTotalData].reverse().find((p) => Number.isFinite(p.value))?.value ?? null;
    const breakdown = buildDiskBreakdown(
      data?.metrics.find((m) => m.metric === 'disk_database')?.data,
      data?.metrics.find((m) => m.metric === 'disk_wal')?.data,
      diskUsedData
    );
    // Figma disk design (node 3579:68356, Tony 2026-08-08): the y-axis is the
    // whole disk read as a percentage — 0% at the floor, a dotted reference
    // line at 90% (where a filling disk becomes a problem), no ceiling line.
    // Bars stack the true absolutes bottom-up (System, WAL, Database), so the
    // gap above the stack is the free share of the disk.
    // With a breakdown the primary series (headline + AVG/MAX/LATEST + hover
    // points) is the per-sample used total — the same stack the bars draw.
    const usedSeries = breakdown
      ? breakdown.database.map((point, i) => ({
          timestamp: point.timestamp,
          value: point.value + (breakdown.wal[i]?.value ?? 0) + (breakdown.system[i]?.value ?? 0),
        }))
      : diskUsedData;
    return {
      data: usedSeries,
      fixedDomain: (totalBytes !== null ? [0, totalBytes] : undefined) as
        | [number, number]
        | undefined,
      ticks:
        totalBytes !== null
          ? breakdown
            ? [0, totalBytes * 0.9]
            : [0, totalBytes / 2, totalBytes]
          : [],
      // Percent labels against the disk in breakdown mode (the design's
      // "90% / 0%" rail); byte labels for the single-color fallback, whose
      // dashed ceiling still reads as the provisioned size.
      axisLabel:
        breakdown && totalBytes
          ? (v: number) => `${Math.round((v / totalBytes) * 100)}%`
          : BYTES_SIZE,
      totalBytes,
      breakdown,
      tooltipDetail:
        totalBytes !== null && totalBytes > 0
          ? (v: number) => `${((v / totalBytes) * 100).toFixed(1)}% of ${BYTES_SIZE(totalBytes)}`
          : undefined,
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
          {memoryAdvisoryPct !== null && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--alpha-8)] bg-card p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] text-muted-foreground">
                  <MemoryStick className="h-5 w-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-medium leading-5 text-foreground">
                    {t('overview.memoryAdvisory.title', {
                      value: PERCENT(memoryAdvisoryPct),
                      defaultValue: "Memory is sitting at {{value}}. For Postgres, that's normal.",
                    })}
                  </p>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {t('overview.memoryAdvisory.description', {
                      defaultValue:
                        "Postgres grabs spare memory to cache your data and keeps it, even when the database is idle. A high number here doesn't mean something is wrong. The warning signs that actually matter are restarts and queries slowing down. If you're seeing those, a bigger instance will give it room.",
                    })}
                  </p>
                </div>
              </div>
              {canOpenComputeSettings && (
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
                  fixedDomain={diskCardProps.fixedDomain}
                  formatAxisLabel={diskCardProps.axisLabel}
                  capacity={
                    diskCardProps.fixedDomain
                      ? {
                          ticks: diskCardProps.ticks,
                          legend: {
                            ceiling: t('overview.metrics.diskUsed.ceiling', {
                              defaultValue: 'Disk Size',
                            }),
                            used: t('overview.metrics.diskUsed.used', {
                              defaultValue: 'Used',
                            }),
                          },
                          // Figma palette (3579:68356): System carries the
                          // house emerald because it is the dominant band,
                          // WAL sky, Database purple; stacked bottom-up in
                          // that order, which is also the header legend
                          // order.
                          components: diskCardProps.breakdown
                            ? [
                                {
                                  key: 'system',
                                  label: t('overview.metrics.diskUsed.system', {
                                    defaultValue: 'System',
                                  }),
                                  fillClass: 'fill-emerald-300',
                                  data: diskCardProps.breakdown.system,
                                },
                                {
                                  key: 'wal',
                                  label: t('overview.metrics.diskUsed.wal', {
                                    defaultValue: 'WAL',
                                  }),
                                  fillClass: 'fill-sky-600',
                                  data: diskCardProps.breakdown.wal,
                                },
                                {
                                  key: 'database',
                                  label: t('overview.metrics.diskUsed.database', {
                                    defaultValue: 'Database',
                                  }),
                                  fillClass: 'fill-purple-600',
                                  data: diskCardProps.breakdown.database,
                                },
                              ]
                            : undefined,
                          tooltipRows: ((breakdown) =>
                            breakdown
                              ? (timestamp: number) => {
                                  const total = diskCardProps.totalBytes;
                                  let idx = -1;
                                  let bestDelta = Infinity;
                                  breakdown.database.forEach((point, i) => {
                                    const delta = Math.abs(point.timestamp - timestamp);
                                    if (delta < bestDelta) {
                                      bestDelta = delta;
                                      idx = i;
                                    }
                                  });
                                  if (idx < 0 || bestDelta > 600) {
                                    return null;
                                  }
                                  const pct = (v: number) =>
                                    total ? ` (${((v / total) * 100).toFixed(2)}%)` : '';
                                  const db = breakdown.database[idx].value;
                                  const wal = breakdown.wal[idx].value;
                                  const system = breakdown.system[idx].value;
                                  const used = system + db + wal;
                                  // Same rows, same order as the Supabase
                                  // disk tooltip: the ceiling, the three
                                  // components, and a Total footer.
                                  const rows = [
                                    {
                                      label: t('overview.metrics.diskUsed.ceiling', {
                                        defaultValue: 'Disk Size',
                                      }),
                                      value: total !== null ? BYTES_SIZE(total) : '—',
                                    },
                                    {
                                      label: t('overview.metrics.diskUsed.database', {
                                        defaultValue: 'Database',
                                      }),
                                      value: `${BYTES_SIZE(db)}${pct(db)}`,
                                      swatchClass: 'bg-purple-600',
                                    },
                                    {
                                      label: t('overview.metrics.diskUsed.wal', {
                                        defaultValue: 'WAL',
                                      }),
                                      value: `${BYTES_SIZE(wal)}${pct(wal)}`,
                                      swatchClass: 'bg-sky-600',
                                    },
                                    {
                                      label: t('overview.metrics.diskUsed.system', {
                                        defaultValue: 'System',
                                      }),
                                      value: `${BYTES_SIZE(system)}${pct(system)}`,
                                      swatchClass: 'bg-emerald-300',
                                    },
                                    {
                                      label: t('overview.metrics.diskUsed.total', {
                                        defaultValue: 'Total',
                                      }),
                                      value: `${BYTES_SIZE(used)}${pct(used)}`,
                                    },
                                  ];
                                  return rows;
                                }
                              : undefined)(diskCardProps.breakdown),
                        }
                      : undefined
                  }
                  tooltipDetail={diskCardProps.tooltipDetail}
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
          upsell, a paid plan picks a larger instance type. Mounted only while
          open — the sidebar already keeps a permanent instance, and the
          dialog's hooks subscribe on mount whether or not it is shown. */}
      {computeSettingsOpen && (
        <ProjectSettingsMenuDialog
          open={computeSettingsOpen}
          onOpenChange={setComputeSettingsOpen}
          defaultTab="compute"
        />
      )}
    </section>
  );
}
