import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@insforge/ui';
import { usePosthogConnection } from './hooks/usePosthogConnection';
import { onPosthogConnectionStatus } from './lib/postMessage';
import { EmptyConnectPanel } from './components/posthog/EmptyConnectPanel';
import { ConnectStatusBar } from './components/posthog/ConnectStatusBar';
import { ApiKeyCard } from './components/posthog/ApiKeyCard';
import { DisconnectDialog } from './components/posthog/DisconnectDialog';
import { TimeRangeProvider } from './context/TimeRangeContext';
import { TimeRangeSelector } from './components/posthog/TimeRangeSelector';
import { KpiSectionWithTrend } from './components/posthog/KpiSectionWithTrend';
import { BreakdownPanel } from './components/posthog/BreakdownPanel';
import { RetentionCard } from './components/posthog/RetentionCard';
import { RecentReplaysCard } from './components/posthog/RecentReplaysCard';
import { useProjectId } from '../../lib/hooks/useMetadata';

export function AnalyticsPage() {
  const { projectId } = useProjectId();
  const qc = useQueryClient();
  const conn = usePosthogConnection();
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
  const hasConnection = true;

  return (
    <TimeRangeProvider>
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <div className="flex items-center gap-2">
            <TimeRangeSelector />
            <Button variant="ghost" onClick={() => setDisconnecting(true)}>
              Disconnect
            </Button>
          </div>
        </div>
        <ConnectStatusBar connection={c} />
        <ApiKeyCard apiKey={c.apiKey} host={c.host} posthogProjectId={c.posthogProjectId} />
        <KpiSectionWithTrend enabled={hasConnection} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BreakdownPanel breakdown="Page" enabled={hasConnection} />
          <BreakdownPanel breakdown="Country" enabled={hasConnection} />
          <BreakdownPanel breakdown="DeviceType" enabled={hasConnection} />
        </div>
        <RetentionCard enabled={hasConnection} />
        <RecentReplaysCard enabled={hasConnection} />
        <DisconnectDialog open={disconnecting} onClose={() => setDisconnecting(false)} />
      </div>
    </TimeRangeProvider>
  );
}
