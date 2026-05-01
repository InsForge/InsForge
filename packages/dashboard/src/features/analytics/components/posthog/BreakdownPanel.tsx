import { useTimeframe } from '../../context/TimeRangeContext';
import { useWebStats } from '../../hooks/useWebStats';
import { type Breakdown } from '../../services/posthog.api';
import { flagEmoji, countryName, formatNumber } from '../../lib/format';

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

  if (isLoading) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 p-4">
        <h3 className="mb-3 text-sm font-semibold text-destructive">{title}</h3>
        <div className="text-sm text-destructive">Failed to load.</div>
      </div>
    );
  }

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
        <div className="text-sm text-muted-foreground">No data</div>
      </div>
    );
  }

  const top = rows.slice(0, 8);

  return (
    <div className="rounded-lg bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      <ul className="flex flex-col gap-2">
        {top.map((row, i) => (
          <li key={`${row.breakdownValue ?? 'unknown'}-${i}`} className="relative">
            <div
              className="absolute inset-y-0 left-0 rounded bg-primary/10"
              style={{ width: `${Math.max(2, row.uiFillFraction * 100)}%` }}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-between gap-3 px-2 py-1 text-sm">
              <div className="min-w-0 flex-1 text-foreground">
                {renderLabel(breakdown, row.breakdownValue)}
              </div>
              <div className="shrink-0 text-muted-foreground">{formatNumber(row.visitors)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
