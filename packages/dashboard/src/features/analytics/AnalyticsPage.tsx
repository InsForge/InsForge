import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@insforge/ui';
import { usePosthogConnection } from './hooks/usePosthogConnection';
import { usePosthogDashboards } from './hooks/usePosthogDashboards';
import { usePosthogSummary } from './hooks/usePosthogSummary';
import { usePosthogEvents } from './hooks/usePosthogEvents';
import { onPosthogConnectionStatus } from './lib/postMessage';
import { EmptyConnectPanel } from './components/posthog/EmptyConnectPanel';
import { ConnectStatusBar } from './components/posthog/ConnectStatusBar';
import { ApiKeyCard } from './components/posthog/ApiKeyCard';
import { DashboardsListCard } from './components/posthog/DashboardsListCard';
import { DisconnectDialog } from './components/posthog/DisconnectDialog';
import { KpiRow } from './components/posthog/KpiRow';
import { TopEventsCard } from './components/posthog/TopEventsCard';
import { RecentEventsCard } from './components/posthog/RecentEventsCard';
import { useProjectId } from '../../lib/hooks/useMetadata';

export function AnalyticsPage() {
  const { projectId } = useProjectId();
  const qc = useQueryClient();
  const conn = usePosthogConnection();
  const dashboards = usePosthogDashboards(!!conn.data);
  const summary = usePosthogSummary(!!conn.data);
  const events = usePosthogEvents(!!conn.data, 10);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    return onPosthogConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: ['posthog'] });
      }
    });
  }, [qc]);

  if (conn.isLoading) {
    return <div className="p-6">Loading…</div>;
  }

  if (conn.isError) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Analytics</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load PostHog connection. Please refresh, or contact support if it persists.
        </div>
      </div>
    );
  }

  if (!conn.data) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-2xl font-bold text-foreground">Analytics</h1>
        <EmptyConnectPanel projectId={projectId ?? ''} />
      </div>
    );
  }

  const c = conn.data;
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <Button variant="ghost" onClick={() => setDisconnecting(true)}>
          Disconnect
        </Button>
      </div>
      <ConnectStatusBar connection={c} />
      <KpiRow data={summary.data} isLoading={summary.isLoading} error={summary.error} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <RecentEventsCard data={events.data} isLoading={events.isLoading} error={events.error} />
        <TopEventsCard data={summary.data} isLoading={summary.isLoading} error={summary.error} />
      </div>
      <ApiKeyCard apiKey={c.apiKey} host={c.host} posthogProjectId={c.posthogProjectId} />
      <DashboardsListCard
        data={dashboards.data}
        isLoading={dashboards.isLoading}
        error={dashboards.error}
      />
      <DisconnectDialog open={disconnecting} onClose={() => setDisconnecting(false)} />
    </div>
  );
}
