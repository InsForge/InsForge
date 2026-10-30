import { useTranslation } from 'react-i18next';
import type { AIOverviewMetricPoint } from '@insforge/shared-schemas';
import { formatCompactNumber } from '#features/ai/helpers';

function parseBucketLabel(label: string): Date | null {
  if (/^\d{4}-\d{2}$/.test(label)) {
    const date = new Date(`${label}-01T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(label)) {
    const date = new Date(`${label}:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(label);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBucketLabel(label: string) {
  const date = parseBucketLabel(label);

  if (!date) {
    return { axis: label, title: label };
  }

  if (/^\d{4}-\d{2}$/.test(label)) {
    return {
      axis: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(date),
      title: new Intl.DateTimeFormat(undefined, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date),
    };
  }

  if (/T/.test(label)) {
    const hourLabel = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(date);

    return {
      axis: hourLabel,
      title: `${new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(date)}, ${hourLabel}`,
    };
  }

  return {
    axis: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date),
    title: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date),
  };
}

function getNiceChartMax(value: number): number {
  if (value <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function getXAxisLabels(points: AIOverviewMetricPoint[]) {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    return [{ label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' }];
  }

  if (points.length === 2) {
    return [
      { label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' },
      { label: formatBucketLabel(points[1].label).axis, position: 100, align: 'right' },
    ];
  }

  const middleIndex = Math.floor((points.length - 1) / 2);
  return [
    { label: formatBucketLabel(points[0].label).axis, position: 0, align: 'left' },
    {
      label: formatBucketLabel(points[middleIndex].label).axis,
      position: (middleIndex / (points.length - 1)) * 100,
      align: 'center',
    },
    {
      label: formatBucketLabel(points[points.length - 1].label).axis,
      position: 100,
      align: 'right',
    },
  ];
}

export function AIActivityChartCard({
  title,
  points,
  value,
  valueFormatter = formatCompactNumber,
}: {
  title: string;
  points: AIOverviewMetricPoint[];
  value: string;
  valueFormatter?: (value: number) => string;
}) {
  const { t } = useTranslation('chrome');
  const chartHeight = 176;
  const xAxisPadding = 12;
  const max = getNiceChartMax(Math.max(...points.map((point) => point.value), 0));
  const yTicks = [max, max / 2, 0];
  const xAxisLabels = getXAxisLabels(points);

  return (
    <div className="flex h-[280px] flex-col rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between px-2.5">
        <div className="text-[13px] leading-[18px] text-foreground">{title}</div>
        <div className="text-lg font-medium leading-6 text-foreground">{value}</div>
      </div>
      <div className="relative min-h-0 flex-1 px-2.5 pb-4">
        <div className="relative h-full pl-14 pt-2">
          {yTicks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${8 + ((max - tick) / max) * chartHeight}px` }}
            >
              <span className="w-12 pr-2 text-right text-[10px] leading-4 text-muted-foreground">
                {valueFormatter(tick)}
              </span>
              <span className="h-px flex-1 border-t border-dashed border-[var(--alpha-8)]" />
            </div>
          ))}

          {points.length === 0 ? (
            <div className="absolute left-14 right-0 top-2 flex h-44 items-center justify-center text-[12px] leading-4 text-muted-foreground">
              {t('ai.overview.noDataYet', { defaultValue: 'No data yet' })}
            </div>
          ) : (
            <>
              <div className="absolute left-14 right-0 top-2 flex h-44 items-end gap-1">
                {points.map((point, index) => {
                  const label = formatBucketLabel(point.label);

                  return (
                    <div
                      key={`${point.label}-${index}`}
                      role="img"
                      tabIndex={0}
                      aria-label={`${label.title}: ${valueFormatter(point.value)}`}
                      className="group relative flex min-w-0 flex-1 flex-col items-center gap-1 focus-visible:outline-none"
                    >
                      <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 hidden w-[128px] -translate-x-1/2 rounded border border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] px-2 py-1.5 text-[11px] leading-4 text-foreground shadow-lg group-hover:block group-focus:block">
                        <div className="truncate font-medium">{label.title}</div>
                        <div className="truncate text-muted-foreground">
                          {valueFormatter(point.value)}
                        </div>
                      </div>
                      <div
                        className="w-full rounded-t-sm bg-[rgb(var(--disabled))]"
                        style={{
                          height: point.value <= 0 ? 0 : `${(point.value / max) * chartHeight}px`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="absolute left-14 right-0 top-[196px] h-4">
                {xAxisLabels.map((label) => (
                  <span
                    key={`${label.label}-${label.position}`}
                    className={[
                      'absolute top-0 whitespace-nowrap text-[10px] leading-3 text-muted-foreground',
                      label.align === 'center'
                        ? '-translate-x-1/2'
                        : label.align === 'right'
                          ? '-translate-x-full'
                          : '',
                    ].join(' ')}
                    style={{
                      left: `calc(${label.position}% + ${
                        label.align === 'right'
                          ? -xAxisPadding
                          : label.align === 'left'
                            ? xAxisPadding
                            : 0
                      }px)`,
                    }}
                  >
                    {label.label}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
