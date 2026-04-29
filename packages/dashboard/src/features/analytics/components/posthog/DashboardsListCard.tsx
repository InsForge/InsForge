import type { PosthogDashboardsResponse } from '@insforge/shared-schemas';

export function DashboardsListCard({
  data,
  isLoading,
  error,
}: {
  data?: PosthogDashboardsResponse;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading) {
    return <div className="rounded-lg border p-4">Loading dashboards…</div>;
  }
  if (error) {
    return <div className="rounded-lg border p-4 text-red-700">Failed to load dashboards.</div>;
  }
  if (!data) {
    return null;
  }

  if (data.dashboards.length === 0) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="mb-2 text-sm font-semibold">Dashboards</h3>
        <p className="text-sm text-muted-foreground">No dashboards yet. Create one in PostHog.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 text-sm font-semibold">Dashboards ({data.count})</h3>
      <ul className="divide-y">
        {data.dashboards.map((d) => (
          <li key={d.id} className="py-2">
            <a
              className="block text-sm hover:underline"
              href={d.url}
              target="_blank"
              rel="noreferrer"
            >
              {d.name}
            </a>
            {d.lastModifiedAt && (
              <div className="text-xs text-muted-foreground">
                Modified {new Date(d.lastModifiedAt).toLocaleDateString()}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
