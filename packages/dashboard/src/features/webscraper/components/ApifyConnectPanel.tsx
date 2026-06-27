import { Button } from '@insforge/ui';
import { useDashboardHost } from '#lib/config/DashboardHostContext';

export function ApifyConnectPanel({ projectId }: { projectId: string }) {
  const { onConnectApify } = useDashboardHost();

  return (
    <div className="flex flex-col gap-3 self-stretch rounded border border-[var(--alpha-8)] bg-card p-6">
      <p className="text-sm font-medium leading-6 text-foreground">Connect Apify</p>
      <p className="text-sm leading-6 text-muted-foreground">
        Connect your Apify account to bring web-scraping results into your backend — your data, in
        your database. You authorize your own Apify account; nothing is shared.
      </p>
      <Button
        variant="primary"
        disabled={!onConnectApify}
        onClick={() => onConnectApify?.(projectId)}
        className="self-start"
      >
        Connect Apify
      </Button>
    </div>
  );
}
