import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { TimeRangeProvider } from '#features/analytics/context/TimeRangeContext';
import { usePosthogConnection } from '#features/analytics/hooks/usePosthogConnection';
import { AnalyticsSidebar } from './AnalyticsSidebar';
import { EmptyConnectPanel } from './posthog/EmptyConnectPanel';

export default function AnalyticsLayout() {
  const conn = usePosthogConnection();
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { subscribePosthogConnectionStatus } = useDashboardHost();

  useEffect(() => {
    if (!subscribePosthogConnectionStatus) {
      return;
    }
    return subscribePosthogConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: ['posthog'] });
        void navigate('/dashboard/analytics/traffic', { replace: true });
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
  }, [qc, navigate, showToast, subscribePosthogConnectionStatus]);

  return (
    <TimeRangeProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        {renderLayout({
          conn,
          projectId,
          projectIdLoading,
          projectIdError,
        })}
      </div>
    </TimeRangeProvider>
  );
}

function renderLayout({
  conn,
  projectId,
  projectIdLoading,
  projectIdError,
}: {
  conn: ReturnType<typeof usePosthogConnection>;
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
  if (projectIdError || !projectId) {
    return (
      <ErrorState
        title="Failed to load project ID"
        error="Please refresh, or contact support if the problem persists."
      />
    );
  }

  const connection = conn.data ?? null;
  return (
    <>
      <AnalyticsSidebar connection={connection} projectId={projectId} />
      <div className="min-w-0 flex-1 overflow-auto">
        {connection ? (
          <Outlet />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-6 pb-10 pt-10">
              <h1 className="text-2xl font-medium leading-8 text-foreground">Setup Analytics</h1>
              <EmptyConnectPanel projectId={projectId} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
