import { useMemo } from 'react';
import { EmptyState, SearchInput } from '@/components';
import { LogsDataGrid, type LogsColumnDef } from '../components/LogsDataGrid';
import { useMcpUsage } from '../hooks/useMcpUsage';
import { formatTime } from '@/lib/utils/utils';
import { LOGS_PAGE_SIZE } from '../helpers';

export default function MCPLogsPage() {
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

  const mcpColumns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'tool_name',
        name: 'MCP Call',
        width: '12fr',
      },
      {
        key: 'created_at',
        name: 'Time',
        width: 'minmax(200px, 1fr)',
        renderCell: ({ row }) => (
          <p className="text-sm text-gray-900 dark:text-white font-normal leading-6">
            {formatTime(String(row.created_at ?? ''))}
          </p>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-bg-gray dark:bg-neutral-800">
      {/* Header */}
      <div className="px-3 py-4">
        <p className="text-xl text-zinc-950 dark:text-white pl-1 mb-4">MCP</p>
        <div className="flex items-center gap-4">
          <SearchInput
            value={mcpSearchQuery}
            onChange={setMcpSearchQuery}
            placeholder="Search MCP logs"
            className="flex-1 max-w-80 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
            debounceTime={300}
          />
        </div>
      </div>

      {/* Table with Pagination */}
      <div className="flex-1 overflow-hidden">
        {mcpError ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState title="Error loading MCP logs" description={String(mcpError)} />
          </div>
        ) : (
          <LogsDataGrid
            columnDefs={mcpColumns}
            data={mcpLogs}
            loading={mcpLoading}
            currentPage={mcpCurrentPage}
            totalPages={mcpTotalPages}
            pageSize={LOGS_PAGE_SIZE}
            totalRecords={filteredMcpRecords.length}
            onPageChange={setMcpCurrentPage}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {mcpSearchQuery ? 'No MCP logs match your search' : 'No MCP logs found'}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
