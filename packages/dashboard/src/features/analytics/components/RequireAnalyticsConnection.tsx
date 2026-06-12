import { type ReactNode } from 'react';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useAnalyticsConnection } from '#features/analytics/hooks/useAnalytics';
import { EmptyConnectPanel } from './posthog/EmptyConnectPanel';

interface Props {
  children: ReactNode;
}

// AnalyticsLayout short-circuits loading / error / missing-projectId at the layout level
// before this wrapper renders, so the only state we need to handle here is "metadata ready,
// connection query resolved" — either render the EmptyConnectPanel (not connected) or
// pass through to the sub-page.
export function RequireAnalyticsConnection({ children }: Props) {
  const conn = useAnalyticsConnection();
  const { projectId } = useProjectId();

  if (!conn.data) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[640px]">
          <EmptyConnectPanel projectId={projectId ?? ''} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
