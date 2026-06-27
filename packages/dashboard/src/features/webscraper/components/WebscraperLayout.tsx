import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { webscraperQueryKeys, useApifyConnection } from '#features/webscraper/hooks/useWebscraper';
import { ApifyConnectPanel } from './ApifyConnectPanel';
import { ApifyConnectedPanel } from './ApifyConnectedPanel';

export default function WebscraperLayout() {
  const conn = useApifyConnection();
  const { projectId, isLoading: projectIdLoading } = useProjectId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { subscribeApifyConnectionStatus } = useDashboardHost();

  // OAuth completes in the parent cloud shell, which posts the result back here.
  useEffect(() => {
    if (!subscribeApifyConnectionStatus) {
      return;
    }
    return subscribeApifyConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: webscraperQueryKeys.all });
        showToast('Apify connected.', 'info');
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? `Apify connection failed: ${e.reason}`
            : 'Apify connection failed. Please try again.',
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast('Apify connection cancelled.', 'info');
      }
    });
  }, [qc, showToast, subscribeApifyConnectionStatus]);

  if (conn.isLoading || projectIdLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState className="py-0" message="Loading Web Scraper…" />
      </div>
    );
  }
  if (conn.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title="Failed to load Apify connection"
            error="Please refresh, or contact support if the problem persists."
          />
        </div>
      </div>
    );
  }

  const connection = conn.data ?? null;

  return (
    <div className="h-full min-h-0 overflow-auto bg-[rgb(var(--semantic-1))] p-6">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">Web Scraper</h1>
          <p className="text-sm text-muted-foreground">
            Connect a web scraper so your coding agent can pull external data into your backend. Powered by Apify.
          </p>
        </div>
        {!projectId ? (
          <ErrorState
            title="Project ID unavailable"
            error="Please refresh, or contact support if the problem persists."
          />
        ) : connection ? (
          <ApifyConnectedPanel connection={connection} projectId={projectId} />
        ) : (
          <ApifyConnectPanel projectId={projectId} />
        )}
      </div>
    </div>
  );
}
