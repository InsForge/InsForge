import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, RotateCw } from 'lucide-react';
import { useAdvisorIssues, useAdvisorLatest, useTriggerAdvisorScan } from '../../hooks/useAdvisor';
import type { DashboardAdvisorIssue, DashboardAdvisorSeverity } from '../../../../types';
import { useDashboardHost } from '../../../../lib/config/DashboardHostContext';
import { useToast } from '../../../../lib/hooks/useToast';
import { usePageSize } from '../../../../lib/hooks/usePageSize';
import { PaginationControls } from '../../../../components';
import { AdvisoryItem } from './AdvisoryItem';
import { AdvisoryTabs, type AdvisoryTabValue } from './AdvisoryTabs';
import { SeveritySummary } from './SeveritySummary';

const ADVISOR_FETCH_PAGE_SIZE = 100;
const SCAN_POLL_INTERVAL_MS = 3_000;
const SCAN_POLL_MAX_DURATION_MS = 30_000;

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
  const { pageSize, pageSizeOptions, onPageSizeChange } = usePageSize('advisor-issues');
  const [currentPage, setCurrentPage] = useState(1);

  // Reset to first page when severity filter or page size changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [tab, pageSize]);

  const issuesQuery = useMemo(
    () => ({
      severity: tab === 'all' ? undefined : (tab as DashboardAdvisorSeverity),
      limit: pageSize,
      offset: (currentPage - 1) * pageSize,
    }),
    [tab, pageSize, currentPage]
  );
  const latest = useAdvisorLatest();
  const issues = useAdvisorIssues(issuesQuery);
  const trigger = useTriggerAdvisorScan();
  const host = useDashboardHost();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [isScanning, setIsScanning] = useState(false);
  const baselineScanIdRef = useRef<string | undefined>(undefined);
  const pollStartRef = useRef<number | null>(null);
  const refetchLatest = latest.refetch;

  useEffect(() => {
    if (!isScanning) {
      pollStartRef.current = null;
      return;
    }
    if (pollStartRef.current === null) {
      pollStartRef.current = Date.now();
    }
    let cancelled = false;
    const interval = window.setInterval(() => {
      if (cancelled) {
        return;
      }
      void refetchLatest().then((result) => {
        if (cancelled) {
          return;
        }
        const data = result.data;
        const scanIdChanged = !!data && data.scanId !== baselineScanIdRef.current;
        if (scanIdChanged && data.status !== 'running') {
          cancelled = true;
          window.clearInterval(interval);
          setIsScanning(false);
          void queryClient.invalidateQueries({ queryKey: ['advisor', 'issues'] });
          if (data.status === 'failed') {
            showToast('Scan failed. Check backend logs.', 'error');
          } else {
            showToast('Scan complete', 'success');
          }
          return;
        }
        const pollStart = pollStartRef.current ?? Date.now();
        if (Date.now() - pollStart >= SCAN_POLL_MAX_DURATION_MS) {
          cancelled = true;
          window.clearInterval(interval);
          setIsScanning(false);
          showToast('Scan still running. Refresh later to see results.', 'info');
        }
      });
    }, SCAN_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isScanning, refetchLatest, queryClient, showToast]);

  const handleRunScan = () => {
    baselineScanIdRef.current = latest.data?.scanId;
    setIsScanning(true);
    showToast('Scanning… typically takes 5–10s', 'info');
    trigger.mutate(undefined, {
      onError: (error) => {
        setIsScanning(false);
        showToast(`Failed to start scan: ${error.message}`, 'error');
      },
    });
  };

  const summary = latest.data?.summary;
  const lastScanLabel = formatRelative(latest.data?.scannedAt);
  const totalRecords = issues.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const handleCopyAll = async () => {
    const fetcher = host.onRequestAdvisorIssues;
    if (!fetcher || totalRecords === 0) {
      showToast('Nothing to copy', 'info');
      return;
    }
    try {
      // Backend zod caps `limit` at 100, so paginate across the full result set
      // instead of relying on the displayed page.
      const severity = tab === 'all' ? undefined : (tab as DashboardAdvisorSeverity);
      const all: DashboardAdvisorIssue[] = [];
      for (let offset = 0; offset < totalRecords; offset += ADVISOR_FETCH_PAGE_SIZE) {
        const page = await fetcher({
          severity,
          limit: ADVISOR_FETCH_PAGE_SIZE,
          offset,
        });
        all.push(...page.issues);
        if (page.issues.length < ADVISOR_FETCH_PAGE_SIZE) {
          break;
        }
      }
      const blocks = all
        .filter((issue) => issue.recommendation)
        .map(
          (issue) =>
            `-- ${issue.ruleId}\n-- ${issue.title}${issue.affectedObject ? ` (${issue.affectedObject})` : ''}\n${issue.recommendation}`
        );
      if (blocks.length === 0) {
        showToast('No remediations available', 'info');
        return;
      }
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
            disabled={isScanning}
            onClick={handleRunScan}
            className={ADVISOR_BUTTON_CLASS}
          >
            {isScanning ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <RotateCw className="h-5 w-5" />
            )}
            <span className="px-1">{isScanning ? 'Scanning…' : 'Re-run Scan'}</span>
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

      {totalRecords > 0 && (
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalRecords={totalRecords}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageSizeChange={(size) => {
            onPageSizeChange(size);
          }}
          recordLabel="issues"
        />
      )}
    </section>
  );
}
