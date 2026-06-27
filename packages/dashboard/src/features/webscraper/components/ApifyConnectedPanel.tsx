import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useToast } from '#lib/hooks/useToast';
import {
  webscraperQueryKeys,
  useApifyLatestData,
  useApifyRuns,
} from '#features/webscraper/hooks/useWebscraper';
import {
  webscraperService,
  type ApifyConnection,
} from '#features/webscraper/services/webscraper.service';

const APIFY_CONSOLE_URL = 'https://console.apify.com';

function fmtTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtCost(usd: number | null): string {
  return usd === null ? '—' : `$${usd.toFixed(2)}`;
}

function statusMark(status: string | null): string {
  switch (status) {
    case 'SUCCEEDED':
      return '✅';
    case 'FAILED':
    case 'ABORTED':
    case 'TIMED-OUT':
      return '❌';
    case 'RUNNING':
    case 'READY':
      return '🔄';
    default:
      return '•';
  }
}

// Natural-language prompt for the user's coding agent: infer a table from the
// scraped sample, then write an edge function that pulls the dataset into it.
// This is how data lands in the user's DB — InsForge stays out of the pipeline.
function buildImportPrompt(datasetId: string, sample: unknown): string {
  return [
    `I have an Apify dataset (id: ${datasetId}) connected to my InsForge project. Using InsForge:`,
    '1. Create a table whose columns match the fields in the sample item below (infer sensible types).',
    '2. Write an InsForge edge function that:',
    '   - gets a fresh Apify token: GET `${INSFORGE_BASE_URL}/api/webscraper/apify/token` with header `Authorization: Bearer ${API_KEY}`',
    `   - fetches items: GET https://api.apify.com/v2/datasets/${datasetId}/items?clean=true`,
    '   - upserts them into that table (dedupe by a stable id field).',
    'Sample item:',
    JSON.stringify(sample ?? {}, null, 2),
  ].join('\n');
}

export function ApifyConnectedPanel({
  connection,
  projectId,
}: {
  connection: ApifyConnection;
  projectId: string;
}) {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { onConnectApify } = useDashboardHost();
  const [disconnecting, setDisconnecting] = useState(false);
  const isActive = connection.status === 'active';
  const runs = useApifyRuns(isActive);
  const latest = useApifyLatestData(isActive);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await webscraperService.disconnectApify();
      await qc.invalidateQueries({ queryKey: webscraperQueryKeys.all });
      showToast('Apify disconnected.', 'info');
    } catch {
      showToast('Failed to disconnect Apify.', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const runItems = runs.data ?? [];
  const previewItems = latest.data?.items ?? [];
  const datasetId = latest.data?.datasetId ?? null;
  const unhealthy = !isActive;

  const handleCopyPrompt = async () => {
    if (!datasetId || previewItems.length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(buildImportPrompt(datasetId, previewItems[0]));
      showToast('Import prompt copied — paste it into your coding agent.', 'info');
    } catch {
      showToast('Could not copy to clipboard.', 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4 self-stretch">
      {/* Health banner — only when degraded / revoked */}
      {unhealthy && (
        <div className="flex items-center justify-between gap-3 rounded border border-warning bg-warning/10 p-4">
          <p className="text-sm text-warning">
            Apify connection is {connection.status}. Token refresh may have failed — reconnect to
            restore access.
          </p>
          <Button
            variant="secondary"
            disabled={!onConnectApify}
            onClick={() => onConnectApify?.(projectId)}
            className="shrink-0"
          >
            Reconnect
          </Button>
        </div>
      )}

      {/* Connection header */}
      <div className="flex items-center justify-between gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium leading-6 text-foreground">Apify connected</p>
          <p className="truncate text-sm leading-6 text-muted-foreground">
            {connection.apifyUsername ?? 'account'}
            {connection.email ? ` · ${connection.email}` : ''} · {connection.status}
          </p>
          {(connection.planTier || connection.plan || connection.dataRetentionDays != null) && (
            <p className="truncate text-xs leading-5 text-muted-foreground">
              {connection.planTier ?? connection.plan ?? 'Unknown plan'}
              {connection.dataRetentionDays != null
                ? ` · Apify keeps datasets ${connection.dataRetentionDays} days`
                : ''}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={APIFY_CONSOLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Open in Apify ↗
          </a>
          <Button
            variant="secondary"
            disabled={disconnecting}
            onClick={() => void handleDisconnect()}
          >
            Disconnect
          </Button>
        </div>
      </div>

      {/* Recent runs */}
      <div className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-6">
        <p className="text-sm font-medium leading-6 text-foreground">Recent runs</p>
        {!isActive ? (
          <p className="text-sm text-muted-foreground">Reconnect to load runs.</p>
        ) : runs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : runs.isError ? (
          <p className="text-sm text-warning">Could not load runs. Try refreshing.</p>
        ) : runItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--alpha-8)]">
            {runItems.map((r) => (
              <a
                key={r.id}
                href={`${APIFY_CONSOLE_URL}/actors/runs/${r.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-[var(--alpha-4)]"
              >
                <span className="min-w-0 flex-1 truncate text-foreground" title={r.actorName ?? undefined}>
                  {r.actorName ?? 'Unknown actor'}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {statusMark(r.status)} {r.status ?? '—'}
                </span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                  {fmtTime(r.startedAt)}
                </span>
                <span className="shrink-0 text-muted-foreground">{fmtCost(r.usageTotalUsd)}</span>
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Latest data preview + import-prompt handoff */}
      <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-card p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium leading-6 text-foreground">Latest data preview</p>
          {datasetId && previewItems.length > 0 && (
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() => void handleCopyPrompt()}
            >
              Copy import prompt
            </Button>
          )}
        </div>
        {!isActive ? (
          <p className="text-sm text-muted-foreground">Reconnect to load data.</p>
        ) : latest.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : latest.isError ? (
          <p className="text-sm text-warning">Could not load data from Apify. Try refreshing.</p>
        ) : latest.data?.limitReached ? (
          <p className="text-sm text-warning">
            Apify has locked this dataset because the account reached its monthly usage limit.
            Upgrade your Apify plan to keep loading data.
          </p>
        ) : previewItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{previewItems.length} items shown</p>
            <pre className="max-h-72 overflow-auto rounded border border-[var(--alpha-8)] bg-semantic-1 p-3 font-mono text-xs leading-5 text-foreground">
              {JSON.stringify(previewItems.slice(0, 3), null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
