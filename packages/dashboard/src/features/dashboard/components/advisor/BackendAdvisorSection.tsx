import { useMemo, useState } from 'react';
import { Copy, Loader2, RotateCw } from 'lucide-react';
import { useAdvisorIssues, useAdvisorLatest, useTriggerAdvisorScan } from '../../hooks/useAdvisor';
import type { DashboardAdvisorSeverity } from '../../../../types';
import { useToast } from '../../../../lib/hooks/useToast';
import { AdvisoryItem } from './AdvisoryItem';
import { AdvisoryTabs, type AdvisoryTabValue } from './AdvisoryTabs';
import { SeveritySummary } from './SeveritySummary';

function formatRelative(iso: string | undefined): string {
  if (!iso) {
    return 'never';
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return 'never';
  }
  const minutes = Math.floor((Date.now() - t) / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ADVISOR_BUTTON_CLASS =
  'flex items-center gap-1 rounded border border-[var(--alpha-8)] bg-card px-1 py-1 text-sm leading-5 text-foreground transition-colors hover:bg-[var(--alpha-4)] disabled:opacity-50';

export function BackendAdvisorSection() {
  const [tab, setTab] = useState<AdvisoryTabValue>('all');
  const latest = useAdvisorLatest();
  const issuesQuery = useMemo(
    () => ({
      severity: tab === 'all' ? undefined : (tab as DashboardAdvisorSeverity),
      limit: 50,
      offset: 0,
    }),
    [tab]
  );
  const issues = useAdvisorIssues(issuesQuery);
  const trigger = useTriggerAdvisorScan();
  const { showToast } = useToast();

  const handleRunScan = () => {
    trigger.mutate(undefined, {
      onSuccess: () => {
        showToast('Scan started. Results will refresh shortly.', 'success');
      },
      onError: (error) => {
        showToast(`Failed to start scan: ${error.message}`, 'error');
      },
    });
  };

  const summary = latest.data?.summary;
  const lastScanLabel = formatRelative(latest.data?.scannedAt);

  const handleCopyAll = async () => {
    const blocks = (issues.data?.issues ?? [])
      .filter((issue) => issue.recommendation)
      .map(
        (issue) =>
          `-- ${issue.ruleId}\n-- ${issue.title}${issue.affectedObject ? ` (${issue.affectedObject})` : ''}\n${issue.recommendation}`
      );
    if (blocks.length === 0) {
      showToast('Nothing to copy', 'info');
      return;
    }
    try {
      await navigator.clipboard.writeText(blocks.join('\n\n'));
      showToast(`Copied ${blocks.length} remediation${blocks.length === 1 ? '' : 's'}`, 'success');
    } catch {
      showToast('Failed to copy remediations', 'error');
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-medium leading-7 text-foreground">Backend Advisor</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs leading-4 text-muted-foreground">Last scan {lastScanLabel}</span>
          <button
            type="button"
            disabled={trigger.isPending}
            onClick={handleRunScan}
            className={ADVISOR_BUTTON_CLASS}
          >
            {trigger.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <RotateCw className="h-5 w-5" />
            )}
            <span className="px-1">Re-run Scan</span>
          </button>
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            className={ADVISOR_BUTTON_CLASS}
          >
            <Copy className="h-5 w-5" />
            <span className="px-1">Copy All Remediations</span>
          </button>
        </div>
      </div>

      <SeveritySummary summary={summary} />

      <div className="flex flex-col rounded border border-[var(--alpha-8)] bg-card">
        <AdvisoryTabs value={tab} onChange={setTab} summary={summary} />
        {issues.isLoading ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : issues.isError ? (
          <div className="flex h-24 items-center justify-center text-sm text-destructive">
            Failed to load advisor issues
          </div>
        ) : issues.data && issues.data.issues.length > 0 ? (
          <div className="flex flex-col">
            {issues.data.issues.map((issue) => (
              <AdvisoryItem key={issue.id} issue={issue} />
            ))}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            No issues found
          </div>
        )}
      </div>
    </section>
  );
}
