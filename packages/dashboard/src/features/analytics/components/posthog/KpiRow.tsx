import type { PosthogSummary } from '@insforge/shared-schemas';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

export function KpiRow({
  data,
  isLoading,
  error,
}: {
  data?: PosthogSummary;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile label="Events today" value={formatNumber(data.todayEvents)} />
      <StatTile label="Active users (24h)" value={formatNumber(data.dau24h)} />
      <StatTile label="Events (7d)" value={formatNumber(data.totalEvents7d)} />
    </div>
  );
}
