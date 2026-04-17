import { useState, useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAIUsageSummary, useAIUsageRecords } from '../hooks/useAIUsage';
import { Button } from '@insforge/ui';
import type { AIUsageRecordSchema } from '@insforge/shared-schemas';
import { useQueryClient } from '@tanstack/react-query';

type DateRange = 'week' | 'month' | 'all';

function UsageTypeBadge({ type }: { type?: string }) {
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold text-foreground tabular-nums">{value}</span>
    </div>
  );
}

export default function AIUsagePage() {
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const queryClient = useQueryClient();

  const dateParams = useMemo(() => {
    const now = new Date();
    if (dateRange === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { startDate: start.toISOString() };
    }
    if (dateRange === 'month') {
      const start = new Date(now);
      start.setMonth(start.getMonth() - 1);
      return { startDate: start.toISOString() };
    }
    return {};
  }, [dateRange]);

  const { data: summary, isLoading: isLoadingSummary } = useAIUsageSummary(dateParams);
  const { data: usageData, isLoading: isLoadingRecords } = useAIUsageRecords({
    ...dateParams,
    limit: String(pageSize),
    offset: String(page * pageSize),
  });

  const records = usageData?.records ?? [];
  const total = usageData?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ai-usage-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['ai-usage-records'] });
  };

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      {/* Header */}
      <div className="flex flex-col items-center px-10 flex-shrink-0">
        <div className="max-w-[1024px] w-full flex flex-col gap-4 pt-10 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-medium text-foreground leading-8">Usage</h1>
              <p className="text-sm leading-5 text-muted-foreground mt-1">
                Track AI token consumption across chat, embedding, and image generation requests.
              </p>
            </div>
            <Button variant="secondary" onClick={handleRefresh} className="h-9 rounded px-3">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          </div>

          {/* Date Range Filter */}
          <div className="flex gap-2">
            {(
              [
                ['week', 'This week'],
                ['month', 'This month'],
                ['all', 'All time'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                variant={dateRange === key ? 'primary' : 'secondary'}
                onClick={() => {
                  setDateRange(key);
                  setPage(0);
                }}
                className="h-8 rounded px-3 text-sm"
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto pb-6">
          {/* Summary Cards */}
          {isLoadingSummary ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : summary ? (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
              <StatCard label="Total Requests" value={summary.totalRequests} />
              <StatCard label="Input Tokens" value={summary.totalInputTokens.toLocaleString()} />
              <StatCard label="Output Tokens" value={summary.totalOutputTokens.toLocaleString()} />
              <StatCard label="Images Generated" value={summary.totalImageCount} />
              <StatCard label="Embedding Requests" value={summary.embeddingRequests ?? 0} />
              <StatCard
                label="Embedding Tokens"
                value={(summary.embeddingTokens ?? 0).toLocaleString()}
              />
            </div>
          ) : null}

          {/* Usage Records Table */}
          <div className="bg-card border border-[var(--alpha-8)] rounded py-2 flex flex-col">
            <div className="px-4 py-2 text-sm font-medium text-foreground border-b border-[var(--alpha-8)] flex items-center justify-between">
              <span>Usage Records</span>
              <span className="text-xs text-muted-foreground">{total} total</span>
            </div>
            <div className="grid grid-cols-5 gap-x-2.5 h-8 items-center text-sm leading-5 text-muted-foreground px-4 border-b border-[var(--alpha-8)]">
              <div>Time</div>
              <div>Model</div>
              <div>Type</div>
              <div>Input tokens</div>
              <div>Output tokens</div>
            </div>
            {isLoadingRecords ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : records.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No usage records found.
              </div>
            ) : (
              records.map((record: AIUsageRecordSchema) => (
                <div
                  key={record.id}
                  className="grid grid-cols-5 gap-x-2.5 h-10 items-center text-sm px-4 border-b border-[var(--alpha-8)] last:border-b-0 hover:bg-[var(--alpha-4)] transition-colors"
                >
                  <div className="text-muted-foreground text-xs">
                    {new Date(record.createdAt).toLocaleString()}
                  </div>
                  <div
                    className="truncate text-foreground"
                    title={record.model ?? record.modelId ?? '—'}
                  >
                    {record.model ?? record.modelId ?? '—'}
                  </div>
                  <div>
                    <UsageTypeBadge type={record.usageType} />
                  </div>
                  <div className="text-foreground tabular-nums">{record.inputTokens ?? '—'}</div>
                  <div className="text-foreground tabular-nums">{record.outputTokens ?? '—'}</div>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="h-8 rounded px-3 text-sm"
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="h-8 rounded px-3 text-sm"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
