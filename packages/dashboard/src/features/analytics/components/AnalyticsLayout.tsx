import { useEffect, type ReactNode } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { LoadingState } from '#components';
import { ErrorState } from '#components/ErrorState';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { TimeRangeProvider } from '#features/analytics/context/TimeRangeContext';
import { usePosthogConnection } from '#features/analytics/hooks/usePosthogConnection';
import { AnalyticsSidebar } from './AnalyticsSidebar';

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

  const connection = conn.data ?? null;

  let topLevelStatus: ReactNode | null = null;
  if (conn.isLoading || projectIdLoading) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState className="py-0" message="Loading Analytics…" />
      </div>
    );
  } else if (conn.isError) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title="Failed to load PostHog connection"
            error="Please refresh, or contact support if the problem persists."
          />
        </div>
      </div>
    );
  } else if (projectIdError || !projectId) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title="Failed to load project ID"
            error="Please refresh, or contact support if the problem persists."
          />
        </div>
      </div>
    );
  }

  return (
    <TimeRangeProvider>
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <AnalyticsSidebar connection={connection} projectId={projectId ?? ''} />
        <div className="min-w-0 flex-1 overflow-hidden">{topLevelStatus ?? <Outlet />}</div>
      </div>
    </TimeRangeProvider>
  );
}
