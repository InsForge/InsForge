import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '@insforge/ui';
import { TimeRangeProvider } from '#features/analytics/context/TimeRangeContext';
import { analyticsQueryKeys, useAnalyticsConnection } from '#features/analytics/hooks/useAnalytics';
import { AnalyticsSidebar } from './AnalyticsSidebar';

export default function AnalyticsLayout() {
  const { t } = useTranslation('chrome');
  const conn = useAnalyticsConnection();
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
        void qc.invalidateQueries({ queryKey: analyticsQueryKeys.all });
        void navigate('/dashboard/analytics/traffic', { replace: true });
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? t('analytics.connectionFailedReason', {
                defaultValue: 'PostHog connection failed: {{reason}}',
                reason: e.reason,
              })
            : t('analytics.connectionFailed', {
                defaultValue: 'PostHog connection failed. Please try again.',
              }),
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast(
          t('analytics.connectionCancelled', {
            defaultValue: 'PostHog connection cancelled.',
          }),
          'info'
        );
      }
    });
  }, [qc, navigate, showToast, subscribePosthogConnectionStatus, t]);

  const connection = conn.data ?? null;

  let topLevelStatus: ReactNode | null = null;
  if (conn.isLoading || projectIdLoading) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState
          className="py-0"
          message={t('analytics.loadingAnalytics', { defaultValue: 'Loading Analytics…' })}
        />
      </div>
    );
  } else if (conn.isError) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title={t('analytics.connectionLoadError', {
              defaultValue: 'Failed to load PostHog connection',
            })}
            error={t('analytics.refreshOrContactSupport', {
              defaultValue: 'Please refresh, or contact support if the problem persists.',
            })}
          />
        </div>
      </div>
    );
  } else if (projectIdError || !projectId) {
    topLevelStatus = (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title={t('analytics.projectIdLoadError', {
              defaultValue: 'Failed to load project ID',
            })}
            error={t('analytics.refreshOrContactSupport', {
              defaultValue: 'Please refresh, or contact support if the problem persists.',
            })}
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
