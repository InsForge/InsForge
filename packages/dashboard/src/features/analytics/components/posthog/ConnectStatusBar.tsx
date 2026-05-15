import type { PosthogConnection } from '@insforge/shared-schemas';
import { Button } from '@insforge/ui';

export function ConnectStatusBar({ connection }: { connection: PosthogConnection }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-card p-4">
      <div>
        <div className="font-medium text-foreground">{connection.projectName}</div>
        <div className="text-xs text-muted-foreground">
          {connection.region} · {connection.organizationName ?? '—'}
        </div>
      </div>
      <Button variant="primary" asChild>
        <a
          href={`${connection.host}/project/${connection.posthogProjectId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open in PostHog
        </a>
      </Button>
    </div>
  );
}
