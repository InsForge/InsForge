import { type ReactNode } from 'react';
import { ErrorState, LoadingState } from '#components';
import { useProjectId } from '#lib/hooks/useMetadata';
import { usePosthogConnection } from '#features/analytics/hooks/usePosthogConnection';
import { EmptyConnectPanel } from './posthog/EmptyConnectPanel';

interface Props {
  children: ReactNode;
}

export function RequirePosthogConnection({ children }: Props) {
  const conn = usePosthogConnection();
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();

  if (conn.isLoading || projectIdLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState className="py-0" />
      </div>
    );
  }
  if (conn.isError || projectIdError || !projectId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title="Failed to load analytics"
            error="Please refresh, or contact support if the problem persists."
          />
        </div>
      </div>
    );
  }
  if (!conn.data) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10">
        <div className="w-full max-w-[640px]">
          <EmptyConnectPanel projectId={projectId} />
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
