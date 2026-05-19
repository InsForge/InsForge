import type { PosthogConnection } from '@insforge/shared-schemas';
import { Button } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';

export function ConnectStatusBar({
  connection,
  projectId,
}: {
  connection: PosthogConnection;
  projectId: string;
}) {
  const directUrl = `${connection.host}/project/${connection.posthogProjectId}`;
  const { onOpenPosthog } = useDashboardHost();

  // Standalone OSS (no cloud parent) keeps today's direct link: account_requests
  // requires a CIMD-partner-signed call that only cloud-backend can issue.
  if (!onOpenPosthog) {
    return (
      <BarShell connection={connection}>
        <Button variant="primary" asChild>
          <a href={directUrl} target="_blank" rel="noreferrer">
            Open in PostHog
          </a>
        </Button>
      </BarShell>
    );
  }

  // Cloud-hosted: every click runs the agentic handshake so PostHog can verify
  // the InsForge user's email against the browser PostHog session. Open the new
  // tab synchronously (blank), await the resolved URL, then set its location —
  // popup blockers cancel any window.open() that happens after an `await`.
  //
  // We can't pass `noopener` in the features string: it forces window.open() to
  // return null, which kills our ability to set `location.href` later. Instead,
  // detach `opener` manually on the about:blank document (same-origin with us)
  // before navigating, so the cross-origin PostHog page can't reach back.
  const handleClick = () => {
    const newTab = window.open('about:blank', '_blank');
    if (!newTab) {
      return;
    }
    try {
      newTab.opener = null;
    } catch {
      // Some browsers throw on the setter for an about:blank window across
      // certain configurations — harmless; we still navigate cross-origin
      // below which severs the relationship in practice.
    }
    onOpenPosthog(projectId)
      .then(({ url, error }) => {
        if (url) {
          newTab.location.href = url;
        } else {
          newTab.close();
          console.error('Open in PostHog failed', error);
        }
      })
      .catch((err) => {
        newTab.close();
        console.error('Open in PostHog threw', err);
      });
  };

  return (
    <BarShell connection={connection}>
      <Button variant="primary" onClick={handleClick}>
        Open in PostHog
      </Button>
    </BarShell>
  );
}

function BarShell({
  connection,
  children,
}: {
  connection: PosthogConnection;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-card p-4">
      <div>
        <div className="font-medium text-foreground">{connection.projectName}</div>
        <div className="text-xs text-muted-foreground">
          {connection.region} · {connection.organizationName ?? '—'}
        </div>
      </div>
      {children}
    </div>
  );
}
