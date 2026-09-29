import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Tabs, Tab, Input, Button } from '@insforge/ui';
import { useLogs } from '#features/logs/hooks/useLogs';
import { EmptyState, TableHeader, DataGridEmptyState } from '#components';
import {
  LogsDataGrid,
  type LogsColumnDef,
  SeverityBadge,
  LogDetailPanel,
  BuildLogsView,
  SeverityFilterDropdown,
} from '#features/logs/components';
import { formatTime } from '#lib/utils/utils';
import { LogSchema } from '@insforge/shared-schemas';
import { usePageSize } from '#lib/hooks/usePageSize';
import { filterFunctionLogs, type FunctionLogFilters } from '#features/logs/helpers';

type FunctionLogType = 'runtime' | 'build';

const SOURCE_NAME = 'function.logs';

export default function FunctionLogsPage() {
  const { t } = useTranslation('chrome');
  const [activeTab, setActiveTab] = useState<FunctionLogType>('runtime');
  const [selectedLog, setSelectedLog] = useState<LogSchema | null>(null);
  const [functionFilters, setFunctionFilters] = useState<FunctionLogFilters>({
    functionSlug: '',
    requestId: '',
    status: '',
    from: '',
    to: '',
  });
  const {
    pageSize,
    pageSizeOptions,
    onPageSizeChange: handlePageSizeChange,
  } = usePageSize('function-logs');

  const {
    allLogs,
    filteredLogs,
    currentPage,
    setCurrentPage,
    hasMore,
    isLoadingMore,
    loadMoreLogs,
    searchQuery: logsSearchQuery,
    setSearchQuery: setLogsSearchQuery,
    severityFilter,
    setSeverityFilter,
    isLoading: logsLoading,
    error: logsError,
    getSeverity,
  } = useLogs(SOURCE_NAME, pageSize);

  const functionOptions = useMemo(
    () =>
      [
        ...new Set(
          allLogs
            .map((log) => log.body.slug)
            .filter((slug): slug is string => typeof slug === 'string')
        ),
      ].sort(),
    [allLogs]
  );
  const statusOptions = useMemo(
    () =>
      [
        ...new Set(
          allLogs
            .map((log) => log.body.status)
            .filter((status): status is number => typeof status === 'number')
        ),
      ].sort((a, b) => a - b),
    [allLogs]
  );
  const functionFilteredLogs = useMemo(
    () => filterFunctionLogs(filteredLogs, functionFilters),
    [filteredLogs, functionFilters]
  );
  const totalPages = Math.ceil(functionFilteredLogs.length / pageSize);
  const logs = useMemo(
    () => functionFilteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [functionFilteredLogs, currentPage, pageSize]
  );

  const updateFunctionFilter = useCallback(
    (key: keyof FunctionLogFilters, value: string) => {
      setFunctionFilters((current) => ({ ...current, [key]: value }));
      setCurrentPage(1);
      setSelectedLog(null);
    },
    [setCurrentPage]
  );

  useEffect(() => {
    setSelectedLog(null);
  }, [activeTab]);

  const handleRowClick = useCallback((log: LogSchema) => {
    setSelectedLog(log);
  }, []);

  const handleSeverityChange = useCallback(
    (nextValue: string[]) => {
      setSeverityFilter(nextValue);
      setSelectedLog(null);
    },
    [setSeverityFilter]
  );

  const handleClosePanel = useCallback(() => {
    setSelectedLog(null);
  }, []);

  const logsColumns: LogsColumnDef<LogSchema>[] = useMemo(
    () => [
      {
        key: 'timestamp',
        name: t('logs.time', { defaultValue: 'Time' }),
        width: '240px',
        renderCell: ({ row }) => (
          <p className="truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
            {formatTime(String(row.timestamp ?? ''))}
          </p>
        ),
      },
      {
        key: 'severity',
        name: t('logs.type', { defaultValue: 'Type' }),
        width: '160px',
        renderCell: ({ row }) => <SeverityBadge severity={getSeverity(row)} />,
      },
      {
        key: 'slug',
        name: t('functions.function', { defaultValue: 'Function' }),
        width: '160px',
        renderCell: ({ row }) => (
          <p className="truncate text-[13px]" title={String(row.body.slug ?? '')}>
            {String(row.body.slug ?? '—')}
          </p>
        ),
      },
      {
        key: 'status',
        name: t('logs.status', { defaultValue: 'Status' }),
        width: '90px',
        renderCell: ({ row }) => (
          <span className="text-[13px]">{String(row.body.status ?? '—')}</span>
        ),
      },
      {
        key: 'duration',
        name: t('logs.duration', { defaultValue: 'Duration' }),
        width: '110px',
        renderCell: ({ row }) => (
          <span className="text-[13px]">
            {typeof row.body.durationMs === 'number'
              ? `${row.body.durationMs}ms`
              : String(row.body.duration ?? '—')}
          </span>
        ),
      },
      {
        key: 'event_message',
        name: t('logs.definition', { defaultValue: 'Definition' }),
        width: selectedLog ? '1fr' : 'minmax(400px, 1fr)',
        minWidth: 300,
        renderCell: ({ row }) => {
          const body = row.body as Record<string, unknown> | undefined;
          const displayMessage = (body?.event_message as string) || String(row.eventMessage ?? '');

          return (
            <div className="flex w-full items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
                {displayMessage}
              </p>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          );
        },
      },
    ],
    [getSeverity, selectedLog, t]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title={SOURCE_NAME}
        leftSlot={
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as FunctionLogType)}
            className="h-8"
          >
            <Tab value="runtime">{t('logs.runtimeLogs', { defaultValue: 'Runtime Logs' })}</Tab>
            <Tab value="build">{t('logs.buildLogs', { defaultValue: 'Build Logs' })}</Tab>
          </Tabs>
        }
        searchValue={logsSearchQuery}
        onSearchChange={setLogsSearchQuery}
        searchPlaceholder={t('logs.searchLogs', { defaultValue: 'Search logs' })}
        showSearch={activeTab === 'runtime'}
        rightActions={
          activeTab === 'runtime' ? (
            <SeverityFilterDropdown value={severityFilter} onChange={handleSeverityChange} />
          ) : undefined
        }
      />

      {activeTab === 'runtime' && (
        <div className="flex flex-wrap items-end gap-2 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4 py-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Function
            <select
              aria-label="Filter by function"
              value={functionFilters.functionSlug}
              onChange={(event) => updateFunctionFilter('functionSlug', event.target.value)}
              className="h-8 min-w-36 rounded border border-[var(--alpha-8)] bg-[rgb(var(--card))] px-2 text-[13px] text-foreground"
            >
              <option value="">All functions</option>
              {functionOptions.map((slug) => (
                <option key={slug} value={slug}>
                  {slug}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Status
            <select
              aria-label="Filter by status"
              value={functionFilters.status}
              onChange={(event) => updateFunctionFilter('status', event.target.value)}
              className="h-8 min-w-28 rounded border border-[var(--alpha-8)] bg-[rgb(var(--card))] px-2 text-[13px] text-foreground"
            >
              <option value="">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Request ID
            <Input
              aria-label="Filter by request ID"
              value={functionFilters.requestId}
              onChange={(event) => updateFunctionFilter('requestId', event.target.value)}
              placeholder="Request ID"
              className="h-8 w-44 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From (local)
            <Input
              aria-label="Filter from time"
              type="datetime-local"
              value={functionFilters.from}
              onChange={(event) => updateFunctionFilter('from', event.target.value)}
              className="h-8 w-48 text-[13px]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            To (local)
            <Input
              aria-label="Filter to time"
              type="datetime-local"
              value={functionFilters.to}
              onChange={(event) => updateFunctionFilter('to', event.target.value)}
              className="h-8 w-48 text-[13px]"
            />
          </label>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadMoreLogs()}
            disabled={!hasMore || isLoadingMore}
            className="h-8"
          >
            {isLoadingMore ? 'Loading…' : 'Load older logs'}
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {activeTab === 'build' ? (
          <BuildLogsView className="h-full" />
        ) : logsError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title={t('logs.errorLoadingLogs', { defaultValue: 'Error loading logs' })}
              description={
                logsError instanceof Error
                  ? logsError.message
                  : t('logs.failedToLoadLogs', {
                      defaultValue: 'Failed to load logs. Please refresh or contact support.',
                    })
              }
            />
          </div>
        ) : (
          <LogsDataGrid
            columnDefs={logsColumns}
            data={logs}
            loading={logsLoading}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            totalRecords={functionFilteredLogs.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={(newSize) => {
              handlePageSizeChange(newSize);
              setCurrentPage(1);
            }}
            paginationRecordLabel={t('logs.recordLabel', { defaultValue: 'logs' })}
            selectedRowId={selectedLog?.id ?? null}
            onRowClick={handleRowClick}
            gridContainerClassName="border-t border-[var(--alpha-8)]"
            rightPanel={
              selectedLog && (
                <div className="h-full w-[480px] shrink-0 border-l border-[var(--alpha-8)]">
                  <LogDetailPanel log={selectedLog} onClose={handleClosePanel} />
                </div>
              )
            }
            emptyState={
              <DataGridEmptyState
                message={t('logs.noLogsMatchFilters', {
                  defaultValue: 'No logs match your filters',
                })}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
