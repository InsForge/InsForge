import type { PosthogSummary } from '@insforge/shared-schemas';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function TopEventsCard({
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
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading top events…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load top events.
      </div>
    );
  }

  if (!data) {
    return null;
  }

  if (data.topEvents.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Top events (7d)</h3>
        <p className="text-sm text-muted-foreground">
          No events yet. Start sending events using your project API key.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Top events (7d)</h3>
      <ul className="divide-y">
        {data.topEvents.map((row) => (
          <li key={row.event} className="flex items-center justify-between py-2">
            <span className="font-mono text-sm text-foreground">{row.event}</span>
            <span className="text-xs text-muted-foreground">{formatNumber(row.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
