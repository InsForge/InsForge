import { useMemo, useState, useCallback, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tabs, Tab } from '@insforge/ui';
import { useLogs } from '../hooks/useLogs';
import { EmptyState, TableHeader } from '@/components';
import {
  LogsDataGrid,
  type LogsColumnDef,
  SeverityBadge,
  LogDetailPanel,
  BuildLogsView,
  SeverityFilterDropdown,
} from '../components';
import { formatTime } from '@/lib/utils/utils';
import { LogSchema } from '@insforge/shared-schemas';

type FunctionLogType = 'runtime' | 'build';

const SOURCE_NAME = 'function.logs';

export default function FunctionLogsPage() {
  const [activeTab, setActiveTab] = useState<FunctionLogType>('runtime');
  const [selectedLog, setSelectedLog] = useState<LogSchema | null>(null);

  const {
    filteredLogs,
    searchQuery: logsSearchQuery,
    setSearchQuery: setLogsSearchQuery,
    severityFilter,
    setSeverityFilter,
    isLoading: logsLoading,
    error: logsError,
    getSeverity,
  } = useLogs(SOURCE_NAME);

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

  const logsColumns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'timestamp',
        name: 'Time',
        width: '240px',
        renderCell: ({ row }) => (
          <p className="truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
            {formatTime(String(row.timestamp ?? ''))}
          </p>
        ),
      },
      {
        key: 'severity',
        name: 'Type',
        width: '160px',
        renderCell: ({ row }) => (
          <SeverityBadge severity={getSeverity(row as unknown as LogSchema)} />
        ),
      },
      {
        key: 'event_message',
        name: 'Definition',
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
    [getSeverity, selectedLog]
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
            <Tab value="runtime">Runtime Logs</Tab>
            <Tab value="build">Build Logs</Tab>
          </Tabs>
        }
        searchValue={logsSearchQuery}
        onSearchChange={setLogsSearchQuery}
        searchPlaceholder="Search logs"
        showSearch={activeTab === 'runtime'}
        rightActions={
          activeTab === 'runtime' ? (
            <SeverityFilterDropdown value={severityFilter} onChange={handleSeverityChange} />
          ) : undefined
        }
      />

      <div className="flex-1 overflow-hidden">
        {activeTab === 'build' ? (
          <BuildLogsView className="h-full" />
        ) : logsError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              title="Error loading logs"
              description={
                logsError instanceof Error
                  ? logsError.message
                  : 'Failed to load logs. Please refresh or contact support.'
              }
            />
          </div>
        ) : (
          <LogsDataGrid
            columnDefs={logsColumns}
            data={filteredLogs}
            loading={logsLoading}
            showPagination={false}
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
              <div className="text-[13px] text-muted-foreground">No logs match your filters</div>
            }
          />
        )}
      </div>
    </div>
  );
}
