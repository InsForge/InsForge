import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, RotateCw } from 'lucide-react';
import {
  useAdvisorCategoryCounts,
  useAdvisorIssues,
  useAdvisorLatest,
  useTriggerAdvisorScan,
} from '../../hooks/useAdvisor';
import type {
  DashboardAdvisorCategory,
  DashboardAdvisorIssue,
  DashboardAdvisorSeverity,
} from '../../../../types';
import { useDashboardHost } from '../../../../lib/config/DashboardHostContext';
import { useToast } from '../../../../lib/hooks/useToast';
import { usePageSize } from '../../../../lib/hooks/usePageSize';
import { EmptyState, PaginationControls } from '../../../../components';
import { AdvisoryItem } from './AdvisoryItem';
import { AdvisoryTabs, type AdvisoryTabValue } from './AdvisoryTabs';
import { SeverityFilterDropdown } from './SeverityFilterDropdown';
import { formatRemediationPromptBatch } from './remediationPrompt';

const ADVISOR_FETCH_PAGE_SIZE = 100;
const SCAN_POLL_INTERVAL_MS = 3_000;
const SCAN_POLL_MAX_DURATION_MS = 30_000;

const ALL_SEVERITIES: readonly DashboardAdvisorSeverity[] = ['critical', 'warning', 'info'];

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
  'flex h-8 items-center gap-1 rounded border border-[var(--alpha-8)] bg-card px-2 text-sm leading-5 text-foreground transition-colors hover:bg-[var(--alpha-4)] disabled:opacity-50';

export function BackendAdvisorSection() {
  const [tab, setTab] = useState<AdvisoryTabValue>('all');
  const [selectedSeverities, setSelectedSeverities] = useState<Set<DashboardAdvisorSeverity>>(
    () => new Set(ALL_SEVERITIES)
  );
  const { pageSize, pageSizeOptions, onPageSizeChange } = usePageSize('advisor-issues');
  const [currentPage, setCurrentPage] = useState(1);

  const allSeveritiesSelected = selectedSeverities.size === ALL_SEVERITIES.length;
  const noSeveritiesSelected = selectedSeverities.size === 0;
  // Server-side severity filter only when exactly one is selected; otherwise we filter client-side.
  const serverSeverity =
    selectedSeverities.size === 1 ? ([...selectedSeverities][0] ?? undefined) : undefined;
  const clientSideSeverityFilter = !allSeveritiesSelected && selectedSeverities.size !== 1;

  const categoryFilter: DashboardAdvisorCategory | undefined =
    tab === 'all' ? undefined : (tab as DashboardAdvisorCategory);

  // Reset to first page when filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [tab, pageSize, selectedSeverities]);

  const issuesQuery = useMemo(
    () => ({
      severity: serverSeverity,
      category: categoryFilter,
      // When client-side filtering severity, fetch the largest page so all items
      // for the active category are available locally for filter+paginate.
      limit: clientSideSeverityFilter ? ADVISOR_FETCH_PAGE_SIZE : pageSize,
      offset: clientSideSeverityFilter ? 0 : (currentPage - 1) * pageSize,
    }),
    [serverSeverity, categoryFilter, clientSideSeverityFilter, pageSize, currentPage]
  );
  const latest = useAdvisorLatest();
  const issues = useAdvisorIssues(issuesQuery);
  const categoryCounts = useAdvisorCategoryCounts();
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
          void queryClient.invalidateQueries({ queryKey: ['advisor', 'category-counts'] });
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

  const lastScanLabel = formatRelative(latest.data?.scannedAt);
  const hasScan = !!latest.data?.scanId;
  const summaryTotal = latest.data?.summary.total;
  const reservedItemsHeight =
    hasScan && summaryTotal && summaryTotal > 0 ? summaryTotal * 68 + 64 : 0;

  // Apply client-side severity filter when needed, then derive pagination.
  const fetchedIssues = issues.data?.issues ?? [];
  const fetchedTotal = issues.data?.total ?? 0;
  const filteredIssues = clientSideSeverityFilter
    ? fetchedIssues.filter((i) => selectedSeverities.has(i.severity))
    : fetchedIssues;
  const visibleIssues = noSeveritiesSelected
    ? []
    : clientSideSeverityFilter
      ? filteredIssues.slice((currentPage - 1) * pageSize, currentPage * pageSize)
      : filteredIssues;
  const totalRecords = noSeveritiesSelected
    ? 0
    : clientSideSeverityFilter
      ? filteredIssues.length
      : fetchedTotal;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const handleCopyAll = async () => {
    const fetcher = host.onRequestAdvisorIssues;
    if (!fetcher || totalRecords === 0) {
      showToast('Nothing to copy', 'info');
      return;
    }
    try {
      const all: DashboardAdvisorIssue[] = [];
      // Backend caps `limit` at 100 — paginate when severity filter is server-side.
      // When client-side, we already have everything in `filteredIssues`.
      if (clientSideSeverityFilter) {
        all.push(...filteredIssues);
      } else {
        for (let offset = 0; offset < fetchedTotal; offset += ADVISOR_FETCH_PAGE_SIZE) {
          const page = await fetcher({
            severity: serverSeverity,
            category: categoryFilter,
            limit: ADVISOR_FETCH_PAGE_SIZE,
            offset,
          });
          all.push(...page.issues);
          if (page.issues.length < ADVISOR_FETCH_PAGE_SIZE) {
            break;
          }
        }
      }
      const actionable = all.filter((issue) => issue.recommendation);
      if (actionable.length === 0) {
        showToast('No remediations available', 'info');
        return;
      }
      await navigator.clipboard.writeText(formatRemediationPromptBatch(actionable));
      showToast(
        `Copied ${actionable.length} remediation${actionable.length === 1 ? '' : 's'}`,
        'success'
      );
    } catch {
      showToast('Failed to copy remediations', 'error');
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-medium leading-7 text-foreground">Backend Advisor</h2>
        <span className="text-xs leading-4 text-muted-foreground">Last scan {lastScanLabel}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdvisoryTabs
          value={tab}
          onChange={setTab}
          totalCount={summaryTotal}
          categoryCounts={categoryCounts.data}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isScanning}
            onClick={handleRunScan}
            className={ADVISOR_BUTTON_CLASS}
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
            <span>{isScanning ? 'Scanning…' : 'Re-scan'}</span>
          </button>
          <SeverityFilterDropdown selected={selectedSeverities} onChange={setSelectedSeverities} />
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            className={ADVISOR_BUTTON_CLASS}
          >
            <Copy className="h-4 w-4" />
            <span>Copy All</span>
          </button>
        </div>
      </div>

      <div
        style={{ minHeight: reservedItemsHeight ? `${reservedItemsHeight}px` : undefined }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)]">
          {!hasScan && !latest.isLoading ? (
            <EmptyState
              className="h-32 gap-1"
              title="No scan yet"
              description="Click Re-scan above to start your first scan"
            />
          ) : issues.isLoading ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : issues.isError ? (
            <div className="flex h-24 items-center justify-center text-sm text-destructive">
              Failed to load advisor issues
            </div>
          ) : visibleIssues.length > 0 ? (
            <div className="flex flex-col">
              {visibleIssues.map((issue) => (
                <AdvisoryItem key={issue.id} issue={issue} />
              ))}
            </div>
          ) : (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              No issues found
            </div>
          )}
        </div>

        {hasScan && totalRecords > 0 && (
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
      </div>
    </section>
  );
}
