import { useState, useMemo, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@insforge/ui';
import { useAIUsageSummary, useAIUsageRecords } from '../hooks/useAIUsage';
import type { AIUsageRecordSchema } from '@insforge/shared-schemas';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

type DateRange = 'today' | 'week' | 'month' | 'all';

const DATE_RANGE_OPTIONS: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'all', label: 'All time' },
];

const USAGE_TYPE_STYLES: Record<string, { bg: string; dot: string; text: string }> = {
  chat: {
    bg: 'bg-[hsl(217,60%,18%)]',
    dot: 'bg-[hsl(217,80%,60%)]',
    text: 'text-[hsl(217,80%,72%)]',
  },
  embedding: {
    bg: 'bg-[hsl(270,50%,18%)]',
    dot: 'bg-[hsl(270,70%,60%)]',
    text: 'text-[hsl(270,70%,72%)]',
  },
  image_generation: {
    bg: 'bg-[hsl(35,60%,16%)]',
    dot: 'bg-[hsl(35,80%,55%)]',
    text: 'text-[hsl(35,80%,68%)]',
  },
};

const USAGE_TYPE_LABELS: Record<string, string> = {
  chat: 'Chat',
  embedding: 'Embed',
  image_generation: 'Image',
};

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function UsageTypeBadge({ type }: { type?: string }) {
  const label = type ?? 'chat';
  const style = USAGE_TYPE_STYLES[label] ?? USAGE_TYPE_STYLES.chat;
  const displayLabel = USAGE_TYPE_LABELS[label] ?? label;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium tracking-wide ${style.bg} ${style.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {displayLabel}
    </span>
  );
}

function StatCard({
  label,
  value,
  compact,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--alpha-8)] bg-muted/20 p-4 flex flex-col gap-1">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
        {label}
      </p>
      <p
        className={`font-semibold text-foreground tabular-nums ${compact ? 'text-base' : 'text-xl'}`}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

function LoadingState({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={`flex items-center justify-center ${height}`}>
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-sm text-destructive">
      <AlertCircle className="w-4 h-4" />
      <span>{message}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
      <p className="text-sm">No usage records for this period</p>
      <p className="text-xs">AI usage will appear here once you start using the gateway.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

interface UsageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageDialog({ open, onOpenChange }: UsageDialogProps) {
  const [dateRange, setDateRange] = useState<DateRange>('all');

  const dateParams = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case 'today': {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return { startDate: start.toISOString() };
      }
      case 'week': {
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        return { startDate: start.toISOString() };
      }
      case 'month': {
        const start = new Date(now);
        start.setMonth(start.getMonth() - 1);
        return { startDate: start.toISOString() };
      }
      default:
        return {};
    }
  }, [dateRange]);

  const {
    data: summary,
    isLoading: isLoadingSummary,
    error: summaryError,
  } = useAIUsageSummary(dateParams);

  const {
    data: usageData,
    isLoading: isLoadingRecords,
    error: recordsError,
  } = useAIUsageRecords({ ...dateParams, limit: '50' });

  const records = usageData?.records ?? [];

  const handleDateRange = useCallback((key: DateRange) => {
    setDateRange(key);
  }, []);

  const formatModel = useCallback((record: AIUsageRecordSchema) => {
    const raw = record.model ?? record.modelId ?? '—';
    // Strip provider prefix for cleaner display
    return raw.replace(/^[^/]+\//, '');
  }, []);

  const formatDate = useCallback((dateStr: string | Date) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  const formatTime = useCallback((dateStr: string | Date) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0 pb-0">
          <DialogTitle>Usage Overview</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor your AI gateway usage across models and request types.
          </p>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 min-h-0 overflow-hidden pt-2">
          {/* Date Range Filter */}
          <div className="flex gap-1 rounded-lg bg-muted/30 p-1 flex-shrink-0 w-fit">
            {DATE_RANGE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => handleDateRange(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dateRange === key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Summary Stats */}
          {summaryError ? (
            <ErrorState message="Failed to load usage summary." />
          ) : isLoadingSummary ? (
            <LoadingState height="h-24" />
          ) : summary ? (
            <div className="grid grid-cols-3 gap-2.5 flex-shrink-0">
              <StatCard label="Requests" value={summary.totalRequests} />
              <StatCard label="Input Tokens" value={summary.totalInputTokens} />
              <StatCard label="Output Tokens" value={summary.totalOutputTokens} />
              <StatCard label="Images" value={summary.totalImageCount} compact />
              <StatCard label="Embeddings" value={summary.embeddingRequests ?? 0} compact />
              <StatCard label="Embed Tokens" value={summary.embeddingTokens ?? 0} compact />
            </div>
          ) : null}

          {/* Records Table */}
          <div className="flex flex-col min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--alpha-8)]">
            {/* Table Title */}
            <div className="flex items-center justify-between px-4 h-10 flex-shrink-0 border-b border-[var(--alpha-8)]">
              <span className="text-sm font-medium text-foreground">Recent Activity</span>
              {records.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  Showing {records.length} record{records.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[80px_40px_1fr_72px_72px_72px] gap-x-2 h-8 items-center text-[11px] font-medium text-muted-foreground px-4 border-b border-[var(--alpha-8)] flex-shrink-0 uppercase tracking-wider">
              <div>Date</div>
              <div>Time</div>
              <div>Model</div>
              <div>Type</div>
              <div className="text-right">In</div>
              <div className="text-right">Out</div>
            </div>

            {/* Table Body */}
            <div className="overflow-y-auto flex-1">
              {recordsError ? (
                <ErrorState message="Failed to load usage records." />
              ) : isLoadingRecords ? (
                <LoadingState />
              ) : records.length === 0 ? (
                <EmptyState />
              ) : (
                records.map((record: AIUsageRecordSchema) => (
                  <div
                    key={record.id}
                    className="grid grid-cols-[80px_40px_1fr_72px_72px_72px] gap-x-2 h-9 items-center text-[13px] px-4 border-b border-[var(--alpha-4)] last:border-b-0 hover:bg-[var(--alpha-4)] transition-colors"
                  >
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatDate(record.createdAt)}
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatTime(record.createdAt)}
                    </div>
                    <div
                      className="truncate text-foreground text-xs font-medium"
                      title={record.model ?? record.modelId ?? '—'}
                    >
                      {formatModel(record)}
                    </div>
                    <div>
                      <UsageTypeBadge type={record.usageType} />
                    </div>
                    <div className="text-right text-foreground text-xs tabular-nums">
                      {record.inputTokens?.toLocaleString() ?? '—'}
                    </div>
                    <div className="text-right text-foreground text-xs tabular-nums">
                      {record.outputTokens?.toLocaleString() ?? '—'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
