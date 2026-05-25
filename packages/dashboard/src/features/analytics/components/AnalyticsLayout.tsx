import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { TimeRangeProvider } from '../context/TimeRangeContext';
import { usePosthogConnection } from '../hooks/usePosthogConnection';
import { AnalyticsSidebar } from './AnalyticsSidebar';
import { EmptyConnectPanel } from './posthog/EmptyConnectPanel';

export default function AnalyticsLayout() {
  const conn = usePosthogConnection();
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { subscribePosthogConnectionStatus } = useDashboardHost();

  useEffect(() => {
    if (!subscribePosthogConnectionStatus) return;
    return subscribePosthogConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: ['posthog'] });
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? `PostHog connection failed: ${e.reason}`
            : 'PostHog connection failed. Please try again.',
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast('PostHog connection cancelled.', 'info');
      }
    });
  }, [qc, showToast, subscribePosthogConnectionStatus]);

  const connection = conn.data ?? null;

  return (
    <TimeRangeProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <AnalyticsSidebar connection={connection} />
        <div className="min-w-0 flex-1 overflow-auto">
          {renderMain({ conn, connection, projectId, projectIdLoading, projectIdError })}
        </div>
      </div>
    </TimeRangeProvider>
  );
}

function renderMain({
  conn,
  connection,
  projectId,
  projectIdLoading,
  projectIdError,
}: {
  conn: ReturnType<typeof usePosthogConnection>;
  connection: ReturnType<typeof usePosthogConnection>['data'] | null;
  projectId: string | null | undefined;
  projectIdLoading: boolean;
  projectIdError: Error | null;
}) {
  if (conn.isLoading || projectIdLoading) {
    return <LoadingState />;
  }
  if (conn.isError) {
    return (
      <ErrorState
        title="Failed to load PostHog connection"
        error="Please refresh, or contact support if the problem persists."
      />
    );
  }
  if (!connection) {
    if (projectIdError || !projectId) {
      return (
        <ErrorState
          title="Failed to load project ID"
          error="Please refresh, or contact support if the problem persists."
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <EmptyConnectPanel projectId={projectId} />
        </div>
      </div>
    );
  }
  return <Outlet />;
}
