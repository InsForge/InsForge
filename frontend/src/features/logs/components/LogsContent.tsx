import { useCallback, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLogs } from '../hooks/useLogs';
import { useMcpUsage } from '../hooks/useMcpUsage';
import { SearchInput } from '@/components/SearchInput';
import { EmptyState } from '@/components/EmptyState';
import { PaginationControls } from '@/components/PaginationControls';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/radix/DropdownMenu';
import { Button } from '@/components/radix/Button';
import { Checkbox } from '@/components/Checkbox';
import { LogsTable, LogsTableColumn } from './LogsTable';
import { LogSchema } from '@insforge/shared-schemas';
import { McpUsageRecord } from '../services/usage.service';
import { format } from 'date-fns';

interface LogsContentProps {
  source: string;
}

const SEVERITY_OPTIONS = [
  { value: 'error', label: 'Error', color: 'text-red-500' },
  { value: 'warning', label: 'Warning', color: 'text-yellow-500' },
  { value: 'informational', label: 'Info', color: 'text-gray-500' },
] as const;

function SeverityBadge({ severity }: { severity: string }) {
  const severityConfig = {
    error: { color: '#EF4444', label: 'Error' },
    warning: { color: '#FCD34D', label: 'Warning' },
    informational: { color: '#A3A3A3', label: 'Info' },
  };

  const config =
    severityConfig[severity as keyof typeof severityConfig] || severityConfig.informational;

  return (
    <div className="flex items-center gap-2 pr-1">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: config.color }} />
      <span className="text-sm text-gray-900 dark:text-white font-normal leading-6">
        {config.label}
      </span>
    </div>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return format(date, 'MMM dd, yyyy, hh:mm a');
}

export function LogsContent({ source }: LogsContentProps) {
  const isMcpLogs = source === 'MCP';

  // MCP logs data
  const {
    records: mcpLogs,
    filteredRecords: filteredMcpRecords,
    searchQuery: mcpSearchQuery,
    setSearchQuery: setMcpSearchQuery,
    currentPage: mcpCurrentPage,
    setCurrentPage: setMcpCurrentPage,
    totalPages: mcpTotalPages,
    isLoading: mcpLoading,
    error: mcpError,
  } = useMcpUsage();

  // Regular logs data
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
  } = useLogs(isMcpLogs ? '' : source);

  // MCP columns
  const mcpColumns = useMemo(
    (): LogsTableColumn<McpUsageRecord>[] => [
      {
        key: 'tool_name',
        label: 'MCP Call',
      },
      {
        key: 'created_at',
        label: 'Time',
        width: '200px',
        render: (record) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {formatTime(record.created_at)}
          </p>
        ),
      },
    ],
    []
  );

  // Regular logs columns
  const renderLogMessage = useCallback(
    (log: (typeof paginatedLogs)[number]) => (
      <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 break-all w-full">
        {log.eventMessage}
      </p>
    ),
    []
  );

  const renderSeverity = useCallback(
    (log: (typeof paginatedLogs)[number]) => <SeverityBadge severity={getSeverity(log)} />,
    [getSeverity]
  );

  const renderTime = useCallback(
    (log: (typeof paginatedLogs)[number]) => (
      <p className="text-sm text-gray-900 dark:text-white font-normal leading-6 flex-1">
        {formatTime(log.timestamp)}
      </p>
    ),
    []
  );

  const logsColumns = useMemo(
    (): LogsTableColumn<LogSchema>[] => [
      {
        key: 'event_message',
        label: 'Logs',
        render: renderLogMessage,
      },
      {
        key: 'severity',
        label: 'Severity',
        width: '120px',
        render: renderSeverity,
      },
      {
        key: 'timestamp',
        label: 'Time',
        width: '200px',
        render: renderTime,
      },
    ],
    [renderLogMessage, renderSeverity, renderTime]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4">
        <p className="text-xl text-zinc-950 dark:text-white mb-4">{source}</p>
        <div className="flex items-center gap-4">
          <SearchInput
            value={isMcpLogs ? mcpSearchQuery : logsSearchQuery}
            onChange={isMcpLogs ? setMcpSearchQuery : setLogsSearchQuery}
            placeholder={isMcpLogs ? 'Search MCP logs' : 'Search logs'}
            className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
            debounceTime={300}
          />
          {!isMcpLogs && (
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
          )}
        </div>
      </div>

      {/* Table - Scrollable */}
      <div className="flex-1 overflow-hidden px-4">
        {isMcpLogs ? (
          mcpError ? (
            <div className="flex items-center justify-center h-full">
              <EmptyState title="Error loading MCP logs" description={String(mcpError)} />
            </div>
          ) : (
            <LogsTable<McpUsageRecord>
              columns={mcpColumns}
              data={mcpLogs}
              isLoading={mcpLoading}
              emptyMessage={mcpSearchQuery ? 'No MCP logs match your search' : 'No MCP logs found'}
            />
          )
        ) : logsError ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState title="Error loading logs" description={String(logsError)} />
          </div>
        ) : (
          <LogsTable<LogSchema>
            columns={logsColumns}
            data={paginatedLogs}
            isLoading={logsLoading}
            emptyMessage={
              logsSearchQuery || severityFilter.length < 3
                ? 'No logs match your search criteria'
                : 'No logs found'
            }
          />
        )}
      </div>

      {/* Pagination - Fixed at Bottom */}
      <PaginationControls
        currentPage={isMcpLogs ? mcpCurrentPage : currentPage}
        totalPages={isMcpLogs ? mcpTotalPages : totalPages}
        onPageChange={isMcpLogs ? setMcpCurrentPage : setCurrentPage}
        totalRecords={isMcpLogs ? filteredMcpRecords.length : filteredLogs.length}
        pageSize={50}
        recordLabel="logs"
      />
    </div>
  );
}
