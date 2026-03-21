import { useState, useMemo } from 'react';
import { Loader2, Activity, Zap, Image, MessageSquare } from 'lucide-react';
import { useAIUsageSummary, useAIUsageRecords } from '../hooks/useAIUsage';
import { StatsCard } from '@/features/dashboard/components/StatsCard';
import type { AIUsageRecordSchema } from '@insforge/shared-schemas';

type DateRange = 'week' | 'month' | 'all';

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return String(n);
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDateRange(range: DateRange): { startDate?: string; endDate?: string } {
  if (range === 'all') {
    return {};
  }
  const now = new Date();
  const start = new Date(now);
  if (range === 'week') {
    start.setDate(start.getDate() - 7);
  }
  if (range === 'month') {
    start.setMonth(start.getMonth() - 1);
  }
  return { startDate: start.toISOString(), endDate: now.toISOString() };
}

const PAGE_SIZE = 50;

export default function AIUsagePage() {
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [page, setPage] = useState(0);

  const { startDate, endDate } = useMemo(() => getDateRange(dateRange), [dateRange]);

  const {
    data: summary,
    isLoading: isLoadingSummary,
    isError: isSummaryError,
    refetch: refetchSummary,
  } = useAIUsageSummary({ startDate, endDate });

  const {
    data: recordsData,
    isLoading: isLoadingRecords,
    isError: isRecordsError,
    refetch: refetchRecords,
  } = useAIUsageRecords({
    startDate,
    endDate,
    limit: String(PAGE_SIZE),
    offset: String(page * PAGE_SIZE),
  });

  const records = recordsData?.records ?? [];
  const total = recordsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleRangeChange = (range: DateRange) => {
    setDateRange(range);
    setPage(0);
  };

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      {/* Header */}
      <div className="flex flex-col items-center px-10 flex-shrink-0">
        <div className="max-w-[1024px] w-full flex flex-col gap-6 pt-10 pb-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-medium text-foreground leading-8">AI Usage</h1>
              <p className="text-sm leading-5 text-muted-foreground">
                Track token consumption and request activity across all AI models.
              </p>
            </div>

            {/* Date range filter */}
            <div className="flex items-center gap-1 bg-card border border-[var(--alpha-8)] rounded p-1">
              {(['week', 'month', 'all'] as DateRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => handleRangeChange(r)}
                  aria-pressed={dateRange === r}
                  className={`px-3 py-1 rounded text-sm font-normal transition-colors ${
                    dateRange === r
                      ? 'bg-[var(--alpha-8)] text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {r === 'week' ? 'This week' : r === 'month' ? 'This month' : 'All time'}
                </button>
              ))}
            </div>
          </div>

          {/* Stats Cards */}
          {isSummaryError ? (
            <div className="flex items-center justify-between rounded border border-[var(--alpha-8)] bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">Failed to load usage summary.</p>
              <button
                onClick={() => void refetchSummary()}
                className="text-sm text-foreground underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
              <StatsCard
                icon={Activity}
                title="Total Requests"
                value={isLoadingSummary ? 0 : (summary?.totalRequests ?? 0)}
                unit="requests"
                description="All AI requests"
                isLoading={isLoadingSummary}
              />
              <StatsCard
                icon={Zap}
                title="Input Tokens"
                value={isLoadingSummary ? 0 : formatTokenCount(summary?.totalInputTokens ?? 0)}
                unit="tokens"
                description="Prompt tokens consumed"
                isLoading={isLoadingSummary}
              />
              <StatsCard
                icon={MessageSquare}
                title="Output Tokens"
                value={isLoadingSummary ? 0 : formatTokenCount(summary?.totalOutputTokens ?? 0)}
                unit="tokens"
                description="Completion tokens generated"
                isLoading={isLoadingSummary}
              />
              <StatsCard
                icon={Image}
                title="Images Generated"
                value={isLoadingSummary ? 0 : (summary?.totalImageCount ?? 0)}
                unit="images"
                description="Total images created"
                isLoading={isLoadingSummary}
              />
              <StatsCard
                icon={Activity}
                title="Embedding Requests"
                value={
                  isLoadingSummary
                    ? 0
                    : ((summary as typeof summary & { embeddingRequests?: number })
                        ?.embeddingRequests ?? 0)
                }
                unit="requests"
                description="Embedding requests"
                isLoading={isLoadingSummary}
              />
              <StatsCard
                icon={Zap}
                title="Embedding Tokens"
                value={
                  isLoadingSummary
                    ? 0
                    : formatTokenCount(
                        (summary as typeof summary & { embeddingTokens?: number })
                          ?.embeddingTokens ?? 0
                      )
                }
                unit="tokens"
                description="Embedding tokens consumed"
                isLoading={isLoadingSummary}
              />
            </div>
          )}
        </div>
      </div>

      {/* Records Table */}
      <div className="flex-1 min-h-0 overflow-y-auto px-10 pb-6">
        <div className="max-w-[1024px] w-full mx-auto">
          <div className="bg-card border border-[var(--alpha-8)] rounded py-2 flex flex-col">
            {/* Table Header */}
            <div className="grid grid-cols-5 gap-x-2.5 h-8 items-center text-sm leading-5 text-muted-foreground px-4 border-b border-[var(--alpha-8)] shrink-0">
              <div>Time</div>
              <div>Model</div>
              <div>Type</div>
              <div>Input tokens</div>
              <div>Output tokens</div>
            </div>

            {/* Table Body */}
            {isLoadingRecords && records.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : isRecordsError ? (
              <div className="flex items-center justify-between h-40 px-4">
                <p className="text-sm text-muted-foreground">Failed to load usage records.</p>
                <button
                  onClick={() => void refetchRecords()}
                  className="text-sm text-foreground underline hover:no-underline"
                >
                  Retry
                </button>
              </div>
            ) : records.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <p className="text-sm text-muted-foreground">No usage records found</p>
                <p className="text-xs text-muted-foreground">
                  Records will appear here after AI requests are made.
                </p>
              </div>
            ) : (
              records.map((record: AIUsageRecordSchema) => (
                <UsageRow key={record.id} record={record} />
              ))
            )}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 px-1">
              <p className="text-sm text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-sm rounded border border-[var(--alpha-8)] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-sm rounded border border-[var(--alpha-8)] text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageRow({ record }: { record: AIUsageRecordSchema }) {
  const usageType = (record as AIUsageRecordSchema & { usageType?: string }).usageType;

  return (
    <div className="grid grid-cols-5 gap-x-2.5 h-10 items-center text-sm px-4 border-b border-[var(--alpha-8)] last:border-b-0 hover:bg-[var(--alpha-4)] transition-colors">
      <div className="text-muted-foreground truncate">{formatDate(record.createdAt)}</div>
      <div className="truncate text-foreground" title={record.model ?? record.modelId ?? '—'}>
        {record.model ?? record.modelId ?? '—'}
      </div>
      <div>
        <TypeBadge type={usageType} />
      </div>
      <div className="text-foreground tabular-nums">
        {record.inputTokens !== null && record.inputTokens !== undefined
          ? formatTokenCount(record.inputTokens)
          : '—'}
      </div>
      <div className="text-foreground tabular-nums">
        {record.outputTokens !== null && record.outputTokens !== undefined
          ? formatTokenCount(record.outputTokens)
          : '—'}
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const label = type ?? 'chat';
  const styles: Record<string, string> = {
    chat: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    embedding: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    image_generation: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[label] ?? styles['chat']}`}
    >
      {label === 'image_generation' ? 'image' : label}
    </span>
  );
}
