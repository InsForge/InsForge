import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Pagination,
} from '@insforge/ui';
import { useAIUsageSummary, useAIUsageRecords } from '../hooks/useAIUsage';
import { formatTime } from '../../../lib/utils/utils';
import type {
  AIUsageSummarySchema,
  AIUsageRecordSchema,
  ModalitySchema,
} from '@insforge/shared-schemas';

type DateRangeOption = 'thisWeek' | 'thisMonth' | 'allTime';

interface DateRange {
  startDate?: string;
  endDate?: string;
}

function getDateRange(range: DateRangeOption): DateRange {
  if (range === 'allTime') {
    return {};
  }
  const now = new Date();
  const endDate = now.toISOString();
  if (range === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: start.toISOString(), endDate };
  }
  // thisWeek: Monday 00:00:00
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
  return { startDate: start.toISOString(), endDate };
}

/** Derive a human-readable request type from the record's output modality. */
function deriveRequestType(outputModality: ModalitySchema[] | null): string {
  if (!outputModality || outputModality.length === 0) {
    return '—';
  }
  if (outputModality.includes('image')) {
    return 'Image';
  }
  if (outputModality.includes('audio')) {
    return 'Audio';
  }
  if (outputModality.includes('text')) {
    return 'Text';
  }
  return outputModality.join(', ');
}

interface PerModelRow {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

const PAGE_SIZE = 25;
/** Fetch limit used solely for the per-model aggregation view. */
const AGGREGATE_LIMIT = '200';

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded p-4 flex flex-col gap-1">
      <p className="text-xs leading-4 text-muted-foreground">{label}</p>
      <p className="text-2xl font-medium text-foreground leading-8">{value.toLocaleString()}</p>
    </div>
  );
}

function SummaryCards({ summary }: { summary: AIUsageSummarySchema }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <SummaryCard label="Total Requests" value={summary.totalRequests} />
      <SummaryCard label="Input Tokens" value={summary.totalInputTokens} />
      <SummaryCard label="Output Tokens" value={summary.totalOutputTokens} />
      <SummaryCard label="Images Generated" value={summary.totalImageCount} />
    </div>
  );
}

function PerModelTable({ rows }: { rows: PerModelRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded flex flex-col">
      <div className="px-4 py-2.5 border-b border-[var(--alpha-8)]">
        <h2 className="text-sm font-medium text-foreground">Usage by model</h2>
      </div>
      <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] gap-x-2.5 h-8 items-center text-sm leading-5 text-muted-foreground px-4 border-b border-[var(--alpha-8)]">
        <div>Model</div>
        <div>Requests</div>
        <div>Input tokens</div>
        <div>Output tokens</div>
      </div>
      {rows.map((row) => (
        <div
          key={row.model}
          className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr] gap-x-2.5 min-h-10 items-center px-4 border-b border-[var(--alpha-8)] last:border-b-0"
        >
          <p className="truncate text-[13px] text-foreground">{row.model}</p>
          <p className="text-[13px] tabular-nums text-foreground">
            {row.requests.toLocaleString()}
          </p>
          <p className="text-[13px] tabular-nums text-foreground">
            {row.inputTokens.toLocaleString()}
          </p>
          <p className="text-[13px] tabular-nums text-foreground">
            {row.outputTokens.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

function RecordRow({ record }: { record: AIUsageRecordSchema }) {
  const createdAtStr = String(record.createdAt);
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-2.5 min-h-10 items-center text-sm leading-5 text-foreground px-4 border-b border-[var(--alpha-8)] last:border-b-0">
      <p className="truncate text-[13px] text-muted-foreground">{formatTime(createdAtStr)}</p>
      <p className="truncate text-[13px]">{record.model ?? record.modelId ?? '—'}</p>
      <p className="truncate text-[13px]">{record.provider ?? '—'}</p>
      <p className="truncate text-[13px]">{deriveRequestType(record.outputModality)}</p>
      <p className="truncate text-[13px] tabular-nums">
        {record.inputTokens !== null && record.inputTokens !== undefined
          ? record.inputTokens.toLocaleString()
          : '—'}
      </p>
      <p className="truncate text-[13px] tabular-nums">
        {record.outputTokens !== null && record.outputTokens !== undefined
          ? record.outputTokens.toLocaleString()
          : '—'}
      </p>
      <p className="truncate text-[13px] tabular-nums">
        {record.imageCount !== null && record.imageCount !== undefined
          ? record.imageCount.toLocaleString()
          : '—'}
      </p>
    </div>
  );
}

export default function AIUsagePage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('thisWeek');
  const [page, setPage] = useState(1);

  const { startDate, endDate } = useMemo(() => getDateRange(dateRange), [dateRange]);

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useAIUsageSummary({ startDate, endDate });

  // High-limit fetch used to build the per-model breakdown table.
  const { data: aggregateData, isLoading: aggregateLoading } = useAIUsageRecords({
    startDate,
    endDate,
    limit: AGGREGATE_LIMIT,
    offset: '0',
  });

  // Separate paginated fetch for the detailed records table.
  const {
    data: recordsData,
    isLoading: recordsLoading,
    error: recordsError,
  } = useAIUsageRecords({
    startDate,
    endDate,
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
  });

  /** Per-model breakdown derived by grouping the aggregate records. */
  const perModelRows = useMemo((): PerModelRow[] => {
    if (!aggregateData?.records) {
      return [];
    }
    const map = new Map<string, PerModelRow>();
    for (const record of aggregateData.records) {
      const key = record.model ?? record.modelId ?? 'Unknown';
      const existing = map.get(key) ?? { model: key, requests: 0, inputTokens: 0, outputTokens: 0 };
      map.set(key, {
        model: key,
        requests: existing.requests + 1,
        inputTokens: existing.inputTokens + (record.inputTokens ?? 0),
        outputTokens: existing.outputTokens + (record.outputTokens ?? 0),
      });
    }
    return Array.from(map.values()).sort((a, b) => b.requests - a.requests);
  }, [aggregateData]);

  const totalPages = recordsData ? Math.max(1, Math.ceil(recordsData.total / PAGE_SIZE)) : 1;

  const handleDateRangeChange = (value: string) => {
    setDateRange(value as DateRangeOption);
    setPage(1);
  };

  const isLoading = summaryLoading || recordsLoading || aggregateLoading;
  const error = summaryError ?? recordsError;

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      {/* Header */}
      <div className="flex flex-col items-center px-10 flex-shrink-0">
        <div className="max-w-[1024px] w-full flex flex-col gap-6 pt-10 pb-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  asChild
                  className="h-8 px-2 text-muted-foreground hover:text-foreground -ml-2"
                >
                  <Link to="/dashboard/ai">
                    <ArrowLeft className="h-4 w-4" />
                  </Link>
                </Button>
                <h1 className="text-2xl font-medium text-foreground leading-8">AI Usage</h1>
              </div>
              <Select value={dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thisWeek">This week</SelectItem>
                  <SelectItem value="thisMonth">This month</SelectItem>
                  <SelectItem value="allTime">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm leading-5 text-muted-foreground">
              Token consumption, requests, and image generation across all configured models.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto pt-2 pb-6 flex flex-col gap-6">
          {error ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm font-normal">{error.message}</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Summary cards */}
              {summary && <SummaryCards summary={summary} />}

              {/* Per-model breakdown */}
              <PerModelTable rows={perModelRows} />

              {/* Records table */}
              <div className="bg-card border border-[var(--alpha-8)] rounded flex flex-col">
                {/* Table Header */}
                <div className="px-4 py-2.5 border-b border-[var(--alpha-8)]">
                  <h2 className="text-sm font-medium text-foreground">Usage records</h2>
                </div>
                <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr_1fr] gap-x-2.5 h-8 items-center text-sm leading-5 text-muted-foreground px-4 border-b border-[var(--alpha-8)]">
                  <div>Time</div>
                  <div>Model</div>
                  <div>Provider</div>
                  <div>Type</div>
                  <div>Input tokens</div>
                  <div>Output tokens</div>
                  <div>Images</div>
                </div>

                {/* Table Body */}
                {!recordsData || recordsData.records.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-muted-foreground">
                    <p className="text-sm">No usage records for this period.</p>
                  </div>
                ) : (
                  <div>
                    {recordsData.records.map((record) => (
                      <RecordRow key={record.id} record={record} />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {recordsData && recordsData.total > PAGE_SIZE && (
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalRecords={recordsData.total}
                    pageSize={PAGE_SIZE}
                    recordLabel="records"
                    onPageChange={setPage}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
