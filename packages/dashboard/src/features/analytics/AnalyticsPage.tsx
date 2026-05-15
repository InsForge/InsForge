import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { Button, CopyButton } from '@insforge/ui';
import { usePosthogConnection } from './hooks/usePosthogConnection';
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
import { useProjectId } from '#lib/hooks/useMetadata';
import { useToast } from '#lib/hooks/useToast';
import { useDashboardHost } from '#lib/config/DashboardHostContext';

const ANALYTICS_SETUP_PROMPT =
  "I'm using InsForge as my backend platform. I want to add product analytics to this project. Read the current directory and use the InsForge skill to set up PostHog analytics for me.";

export function AnalyticsPage() {
  const { projectId, isLoading: projectIdLoading, error: projectIdError } = useProjectId();
  const qc = useQueryClient();
  const conn = usePosthogConnection();
  const { showToast } = useToast();
  const { subscribePosthogConnectionStatus } = useDashboardHost();
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!subscribePosthogConnectionStatus) {
      return;
    }
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
        {projectIdError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Failed to load project ID. Please refresh.
          </div>
        ) : projectIdLoading || !projectId ? (
          <div>Loading…</div>
        ) : (
          <EmptyConnectPanel projectId={projectId} />
        )}
      </div>
    );
  }

  const c = conn.data;

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
        <section className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
          <div className="flex flex-col gap-1">
            <p className="text-base font-medium leading-7 text-foreground">Setup with Prompt</p>
            <p className="text-sm leading-5 text-muted-foreground">
              Paste this into your coding agent to set up PostHog analytics for your app.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
            <div className="flex items-center justify-between">
              <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
                <span className="text-xs font-medium leading-4 text-muted-foreground">prompt</span>
              </div>
              <CopyButton text={ANALYTICS_SETUP_PROMPT} showText={false} className="shrink-0" />
            </div>
            <p className="font-mono text-sm leading-6 text-foreground">{ANALYTICS_SETUP_PROMPT}</p>
          </div>
        </section>
        <ApiKeyCard apiKey={c.apiKey} host={c.host} posthogProjectId={c.posthogProjectId} />
        <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Web Analytics aggregates session data with some delay. After connecting PostHog or
            capturing your first events, it may take a few hours for visitors, views, and sessions
            to appear here.
          </p>
        </div>
        <KpiSectionWithTrend enabled />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <BreakdownPanel breakdown="Page" enabled />
          <BreakdownPanel breakdown="Country" enabled />
          <BreakdownPanel breakdown="DeviceType" enabled />
        </div>
        <RetentionCard enabled />
        <RecentReplaysCard enabled />
        <DisconnectDialog open={disconnecting} onClose={() => setDisconnecting(false)} />
      </div>
    </TimeRangeProvider>
  );
}
