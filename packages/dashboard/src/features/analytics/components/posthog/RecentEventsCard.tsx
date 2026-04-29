import type { PosthogEventsResponse } from '@insforge/shared-schemas';

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function RecentEventsCard({
  data,
  isLoading,
  error,
}: {
  data?: PosthogEventsResponse;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Loading recent events…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load recent events.
      </div>
    );
  }

  if (!data) {
    return null;
  }

  if (data.events.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">Recent events</h3>
        <p className="text-sm text-muted-foreground">
          No events yet. Send your first event from your app.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Recent events</h3>
      <ul className="divide-y">
        {data.events.map((e) => (
          <li key={e.id} className="py-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-foreground">{e.event}</span>
              <span className="text-xs text-muted-foreground">{formatTimestamp(e.timestamp)}</span>
            </div>
            <div className="text-xs text-muted-foreground">distinct_id: {e.distinctId}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
