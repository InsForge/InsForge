import type { PosthogWebOverviewItem } from '@insforge/shared-schemas';
import { useTimeframe } from '../../context/TimeRangeContext';
import { useWebOverview } from '../../hooks/useWebOverview';
import { formatPercent, webOverviewLabel, webOverviewValue } from '../../lib/format';

const KPI_ORDER = ['visitors', 'views', 'sessions', 'bounce_rate', 'session_duration'];

function StatTile({ item }: { item: PosthogWebOverviewItem }) {
  const label = webOverviewLabel(item.key);
  const display = webOverviewValue(item.key, item.value);
  const pct = item.changeFromPreviousPct;
  const showDelta = pct !== null && Number.isFinite(pct);
  const goingUp = (pct ?? 0) > 0;
  // For "decrease is good" metrics (bounce_rate, session_duration is neutral),
  // flip the color logic. Default: up = good = green.
  const isIncreaseBad = item.isIncreaseBad === true;
  const goodDirection = goingUp !== isIncreaseBad;

  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-foreground">{display}</div>
      {showDelta && (
        <div
          className={`text-xs ${goodDirection ? 'text-[rgb(var(--success))]' : 'text-destructive'}`}
        >
          {goingUp ? '↑' : '↓'} {formatPercent(Math.abs(pct ?? 0))} vs previous
        </div>
      )}
    </div>
  );
}

export function KpiRow({ enabled }: { enabled: boolean }) {
  const timeframe = useTimeframe();
  const { data, isLoading, error } = useWebOverview(timeframe, enabled);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {KPI_ORDER.map((k) => (
          <div key={k} className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Loading…
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load metrics.
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Sort items by KPI_ORDER, append any extras at the end.
  const byKey = new Map(data.items.map((it) => [it.key, it]));
  const ordered: PosthogWebOverviewItem[] = [];
  for (const key of KPI_ORDER) {
    const it = byKey.get(key);
    if (it) {
      ordered.push(it);
      byKey.delete(key);
    }
  }
  for (const it of byKey.values()) {
    ordered.push(it);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {ordered.map((it) => (
        <StatTile key={it.key} item={it} />
      ))}
    </div>
  );
}
