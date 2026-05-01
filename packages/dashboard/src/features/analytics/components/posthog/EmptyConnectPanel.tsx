import { Button } from '@insforge/ui';
import { requestPosthogConnect } from '../../lib/postMessage';

export function EmptyConnectPanel({ projectId }: { projectId: string }) {
  return (
    <section className="flex w-full flex-col items-center gap-6 rounded-lg border border-[var(--alpha-8)] bg-card px-6 pb-12 pt-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-xl font-medium leading-7 text-foreground">Connect PostHog</p>
        <p className="text-sm text-muted-foreground">
          One-click setup of a PostHog project for product analytics.
        </p>
      </div>
      <Button variant="primary" onClick={() => requestPosthogConnect(projectId)}>
        Connect PostHog
      </Button>
    </section>
  );
}
