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
  barChart?: boolean;
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
    barChart: true,
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
    barChart: true,
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

// The memory advisory appears from this latest-sample percentage up. Below it
// a dedicated Postgres instance's cache-heavy memory needs no commentary;
// above it headroom is thin enough that growth deserves a nudge.
const MEMORY_ADVISORY_THRESHOLD_PCT = 70;

/**
 * Assemble the Database/WAL/System stack from the metric series. Database and
 * WAL arrive from the cloud sampler and share timestamps; System is derived
 * per sample as (nearest disk_used) − database − wal, clamped at zero — it is
 * never measured, so samples with no disk_used within the 10-minute tolerance
 * are dropped rather than shown with a fabricated System. Returns null when
 * the breakdown series are absent (older cloud backend, self-host) or no
 * sample aligns, so the card falls back to the single-color capacity chart.
 * Exported for tests.
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
    // No disk_used sample near enough to derive System from → drop the
    // sample entirely. Treating System as zero here would silently
    // under-report the used total everywhere it is displayed; if nothing
    // aligns, the null return sends the card to the honest single-color
    // fallback instead.
    const usedValue = nearestUsed(point.timestamp);
    if (usedValue === null) {
      continue;
    }
    alignedDb.push(point);
    alignedWal.push({ timestamp: point.timestamp, value: walValue });
    system.push({
      timestamp: point.timestamp,
      value: Math.max(0, usedValue - point.value - walValue),
    });
  }
  return alignedDb.length ? { database: alignedDb, wal: alignedWal, system } : null;
}

export function densifyDiskBreakdown(
  breakdown: {
    database: DashboardMetricDataPoint[];
    wal: DashboardMetricDataPoint[];
    system: DashboardMetricDataPoint[];
  },
  range: DashboardMetricsRange
): {
  database: DashboardMetricDataPoint[];
  wal: DashboardMetricDataPoint[];
  system: DashboardMetricDataPoint[];
} {
  const DISK_SLOTS = 48;
  const source = breakdown.database;
  const windowEnd = source[source.length - 1].timestamp;
  const step = RANGE_SECONDS[range] / DISK_SLOTS;
  const windowStart = windowEnd - RANGE_SECONDS[range];

  const database: DashboardMetricDataPoint[] = [];
  const wal: DashboardMetricDataPoint[] = [];
  const system: DashboardMetricDataPoint[] = [];

  let idx = 0;

  for (let slot = 0; slot < DISK_SLOTS; slot++) {
    const slotTime = windowStart + (slot + 1) * step;

    while (idx + 1 < source.length && source[idx + 1].timestamp <= slotTime) {
      idx += 1;
    }

    const ts = source[idx].timestamp;

    database.push({
      timestamp: ts,
      value: source[idx].value,
    });

    wal.push({
      timestamp: ts,
      value: breakdown.wal[idx].value,
    });

    system.push({
      timestamp: ts,
      value: breakdown.system[idx].value,
    });
  }

  return { database, wal, system };
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

  // Shown from 70% up (Tony's call, 2026-08-09, replacing the always-on
  // banner): below that the card needs no commentary; at 70%+ the message is
  // "normal, but headroom is thin, upgrade if you expect growth". The value
  // is the latest sample, the same number the Memory card's headline shows.
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
    // Figma disk design (node 3579:68356) with Tony's -4 viewport (2026-08-08):
    // the y-axis starts at a fixed 4 GiB floor so the System band (~5.6 GB of
    // OS + runtime) shows as a visible sliver instead of drowning the chart,
    // and the dotted top line is the real disk size. Labels are true
    // absolutes in GB — the floor only crops the view, it never rewrites a
    // number. Bars stack bottom-up (System, WAL, Database) so the gap above
    // the stack is free space.
    const AXIS_FLOOR_BYTES = 4 * 2 ** 30;
    const axisFloor =
      breakdown && totalBytes !== null && AXIS_FLOOR_BYTES < totalBytes * 0.9
        ? AXIS_FLOOR_BYTES
        : 0;
    // The design draws a dense rail of thin bars, but the fleet sampler's
    // cadence is ~15 min — so the window is cut into fixed slots and each
    // slot repeats the newest sample at its time (a step chart's forward
    // fill; slots before the first sample take that first sample). Slots
    // keep the SOURCE sample's timestamp, so hovering any thin bar shows a
    // real reading and its real time, never an interpolated one.
    const densified = breakdown ? densifyDiskBreakdown(breakdown, range) : null;
    // With a breakdown the chart's primary series is the per-slot used total
    // (the same stack the bars draw), but AVG/MAX/LATEST and the headline
    // timestamp are computed from the RAW per-sample totals — averaging the
    // forward-filled slots would weight each reading by how many slots it
    // happened to fill.
    const usedSeries = densified
      ? densified.database.map((point, i) => ({
          timestamp: point.timestamp,
          value: point.value + (densified.wal[i]?.value ?? 0) + (densified.system[i]?.value ?? 0),
        }))
      : diskUsedData;
    const rawUsedSeries = breakdown
      ? breakdown.database.map((point, i) => ({
          timestamp: point.timestamp,
          value: point.value + (breakdown.wal[i]?.value ?? 0) + (breakdown.system[i]?.value ?? 0),
        }))
      : undefined;
    return {
      data: usedSeries,
      statsData: rawUsedSeries,
      fixedDomain: (totalBytes !== null ? [axisFloor, totalBytes] : undefined) as
        | [number, number]
        | undefined,
      // Breakdown mode: the floor label and a dotted line at the real disk
      // size. Fallback keeps its three byte ticks and dashed ceiling.
      ticks:
        totalBytes !== null
          ? breakdown
            ? [axisFloor, totalBytes]
            : [0, totalBytes / 2, totalBytes]
          : [],
      axisLabel: BYTES_SIZE,
      totalBytes,
      // Raw samples feed the tooltip (real readings); the densified slots
      // feed the bars.
      breakdown,
      densified,
      tooltipDetail:
        totalBytes !== null && totalBytes > 0
          ? (v: number) => `${((v / totalBytes) * 100).toFixed(1)}% of ${BYTES_SIZE(totalBytes)}`
          : undefined,
    };
  }, [data, range]);

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
          {memoryAdvisoryPct !== null && memoryAdvisoryPct >= MEMORY_ADVISORY_THRESHOLD_PCT && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--alpha-8)] bg-card p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] text-muted-foreground">
                  <MemoryStick className="h-5 w-5" />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="text-sm font-medium leading-5 text-foreground">
                    {t('overview.memoryAdvisory.title', {
                      value: PERCENT(memoryAdvisoryPct),
                      defaultValue:
                        "Memory is at {{value}}. For Postgres that's normal, but the headroom is getting thin.",
                    })}
                  </p>
                  <p className="text-sm leading-5 text-muted-foreground">
                    {t('overview.memoryAdvisory.description', {
                      defaultValue:
                        "Postgres grabs spare memory to cache your data and keeps it, so a high number by itself is fine. If you think your usage is going to keep growing, it's worth moving up an instance size now instead of after something breaks.",
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
                    barChart={config.barChart}
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
                  statsData={diskCardProps.statsData}
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
                          components: diskCardProps.densified
                            ? [
                                {
                                  key: 'system',
                                  label: t('overview.metrics.diskUsed.system', {
                                    defaultValue: 'System',
                                  }),
                                  fillClass: 'fill-emerald-300',
                                  data: diskCardProps.densified.system,
                                },
                                {
                                  key: 'wal',
                                  label: t('overview.metrics.diskUsed.wal', {
                                    defaultValue: 'WAL',
                                  }),
                                  fillClass: 'fill-sky-600',
                                  data: diskCardProps.densified.wal,
                                },
                                {
                                  key: 'database',
                                  label: t('overview.metrics.diskUsed.database', {
                                    defaultValue: 'Database',
                                  }),
                                  fillClass: 'fill-purple-600',
                                  data: diskCardProps.densified.database,
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
