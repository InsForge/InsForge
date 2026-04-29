import { Button } from '@insforge/ui';
import { requestPosthogConnect } from '../../lib/postMessage';

export function EmptyConnectPanel({ projectId }: { projectId: string }) {
  return (
    <div className="rounded-lg border p-8 text-center">
      <h2 className="mb-2 text-xl font-semibold">Connect PostHog</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        One-click setup of a PostHog project for product analytics.
      </p>
      <Button onClick={() => requestPosthogConnect(projectId)}>Connect PostHog</Button>
    </div>
  );
}
