import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useLogs } from '../hooks/useLogs';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  SearchInput,
} from '@/components/';
import { LogsDataGrid, type LogsColumnDef } from '../components/LogsDataGrid';
import { SeverityBadge } from '../components/SeverityBadge';
import { SEVERITY_OPTIONS, LOGS_PAGE_SIZE } from '../helpers';
import { formatTime } from '@/lib/utils/utils';
import { LogSchema } from '@insforge/shared-schemas';

export default function LogsPage() {
  // Get the source from the URL params
  const { source = 'insforge.logs' } = useParams<{ source?: string }>();

  const {
    logs: paginatedLogs,
    filteredLogs,
    searchQuery: logsSearchQuery,
    setSearchQuery: setLogsSearchQuery,
    severityFilter,
    setSeverityFilter,
    currentPage,
    setCurrentPage,
    totalPages,
    isLoading: logsLoading,
    error: logsError,
    getSeverity,
  } = useLogs(source);

  const logsColumns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'event_message',
        name: 'Logs',
        width: '10fr',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 truncate">
            {String(row.eventMessage ?? '')}
          </p>
        ),
      },
      {
        key: 'severity',
        name: 'Severity',
        width: '120px',
        renderCell: ({ row }) => (
          <SeverityBadge severity={getSeverity(row as unknown as LogSchema)} />
        ),
      },
      {
        key: 'timestamp',
        name: 'Time',
        width: 'minmax(200px, 1fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 flex-1">
            {formatTime(String(row.timestamp ?? ''))}
          </p>
        ),
      },
    ],
    [getSeverity]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg-gray dark:bg-neutral-800">
      {/* Header */}
      <div className="px-3 py-4">
        <p className="text-xl text-zinc-950 dark:text-white pl-1 mb-4">{source}</p>
        <div className="flex items-center gap-4">
          <SearchInput
            value={logsSearchQuery}
            onChange={setLogsSearchQuery}
            placeholder="Search logs"
            className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
            debounceTime={300}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-32 h-10 justify-between bg-transparent dark:bg-transparent border-gray-300 dark:border-neutral-600 text-zinc-950 dark:text-white"
              >
                Severity
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-48"
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {SEVERITY_OPTIONS.map(({ value, label, color }) => (
                <div
                  key={value}
                  className="flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-zinc-100 dark:hover:bg-neutral-600 rounded-sm"
                  onClick={(e) => {
                    e.preventDefault();
                    setSeverityFilter(
                      severityFilter.includes(value)
                        ? severityFilter.filter((s) => s !== value)
                        : [...severityFilter, value]
                    );
                  }}
                >
                  <Checkbox checked={severityFilter.includes(value)} onChange={() => {}} />
                  <span className={color}>●</span>
                  <span className="text-zinc-950 dark:text-white text-sm">{label}</span>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table with Pagination */}
      <div className="flex-1 overflow-hidden">
        {logsError ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState title="Error loading logs" description={String(logsError)} />
          </div>
        ) : (
          <LogsDataGrid
            columnDefs={logsColumns}
            data={paginatedLogs}
            loading={logsLoading}
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={LOGS_PAGE_SIZE}
            totalRecords={filteredLogs.length}
            onPageChange={setCurrentPage}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {logsSearchQuery || severityFilter.length < 3
                  ? 'No logs match your search criteria'
                  : 'No logs found'}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
