import { EmptyState, ErrorState, LoadingState } from '#components';
import { useTimeframe } from '#features/analytics/context/TimeRangeContext';
import { useWebStats } from '#features/analytics/hooks/useWebStats';
import { type Breakdown } from '#features/analytics/services/analytics.service';
import { flagEmoji, countryName, formatNumber } from '#features/analytics/lib/format';

interface Props {
  breakdown: Breakdown;
  enabled: boolean;
}

const TITLES: Record<Breakdown, string> = {
  Page: 'Top Pages',
  Country: 'Top Countries',
  DeviceType: 'Top Devices',
};

function renderLabel(breakdown: Breakdown, value: string | null) {
  if (!value) {
    return <span className="text-muted-foreground">(unknown)</span>;
  }
  if (breakdown === 'Country') {
    const flag = flagEmoji(value);
    const name = countryName(value);
    return (
      <span className="flex items-center gap-2">
        <span aria-hidden="true">{flag}</span>
        <span className="truncate">{name}</span>
      </span>
    );
  }
  if (breakdown === 'DeviceType') {
    const lower = value.toLowerCase();
    const display = lower.charAt(0).toUpperCase() + lower.slice(1);
    return <span className="truncate">{display}</span>;
  }
  return <span className="truncate font-mono text-xs">{value}</span>;
}

export function BreakdownPanel({ breakdown, enabled }: Props) {
  const timeframe = useTimeframe();
  const { data, isLoading, error } = useWebStats(breakdown, timeframe, enabled);
  const title = TITLES[breakdown];

  const rows = data?.rows ?? [];
  const top = rows.slice(0, 8);

  // Figma container spec: flex flex-col items-start gap-6 p-4 align-self-stretch
  return (
    <div className="flex flex-col items-start gap-6 self-stretch rounded-lg border border-[var(--alpha-8)] bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>

      {isLoading ? (
        <LoadingState className="py-4" />
      ) : error ? (
        <ErrorState title="Failed to load" error="Please try again." />
      ) : top.length === 0 ? (
        <EmptyState title="No data available" />
      ) : (
        <ul className="flex w-full flex-col">
          {top.map((row, i) => (
            <li
              key={`${row.breakdownValue ?? 'unknown'}-${i}`}
              className="flex items-center justify-between gap-3 border-b border-[var(--alpha-8)] py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1 text-sm text-foreground">
                {renderLabel(breakdown, row.breakdownValue)}
              </div>
              <div className="shrink-0 text-sm text-foreground">{formatNumber(row.visitors)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
