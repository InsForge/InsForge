import type { PosthogConnection } from '@insforge/shared-schemas';
import { Button } from '@insforge/ui';

export function ConnectStatusBar({ connection }: { connection: PosthogConnection }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-500/40 bg-emerald-50 p-4 dark:bg-emerald-950/40">
      <div className="flex items-center gap-3">
        <span className="text-emerald-700 dark:text-emerald-400">✓</span>
        <div>
          <div className="font-medium text-foreground">{connection.projectName}</div>
          <div className="text-xs text-muted-foreground">
            {connection.region} · {connection.organizationName ?? '—'}
          </div>
        </div>
      </div>
      <a
        href={`${connection.host}/project/${connection.posthogProjectId}`}
        target="_blank"
        rel="noreferrer"
      >
        <Button variant="outline">Open in PostHog</Button>
      </a>
    </div>
  );
}
