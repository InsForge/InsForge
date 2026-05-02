import { useMemo } from 'react';
import { DataGridEmptyState, EmptyState, TableHeader } from '#components';
import { LogsDataGrid, type LogsColumnDef } from '#features/logs/components';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { formatTime } from '#lib/utils/utils';
import { usePageSize } from '#lib/hooks/usePageSize';

export default function MCPLogsPage() {
  const {
    pageSize,
    pageSizeOptions,
    onPageSizeChange: handlePageSizeChange,
  } = usePageSize('mcp-logs');
  const {
    records: mcpLogs,
    searchQuery: mcpSearchQuery,
    setSearchQuery: setMcpSearchQuery,
    currentPage: mcpCurrentPage,
    setCurrentPage: setMcpCurrentPage,
    totalPages: mcpTotalPages,
    pageSize: mcpPageSize,
    filteredRecordsCount: mcpFilteredRecordsCount,
    isLoading: mcpLoading,
    error: mcpError,
  } = useMcpUsage({ successFilter: null, pageSize });

  const mcpColumns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'tool_name',
        name: 'MCP Call',
        width: '1fr',
        minWidth: 320,
        renderCell: ({ row }) => (
          <p className="truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
            {String(row.tool_name ?? '-')}
          </p>
        ),
      },
      {
        key: 'created_at',
        name: 'Time',
        width: '260px',
        renderCell: ({ row }) => (
          <p className="truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
            {formatTime(String(row.created_at ?? ''))}
          </p>
        ),
      },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="mcp.logs"
        searchValue={mcpSearchQuery}
        onSearchChange={setMcpSearchQuery}
        searchPlaceholder="Search MCP usage"
      />

      <div className="flex-1 overflow-hidden">
        {mcpError ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState title="Error loading MCP logs" description={String(mcpError)} />
          </div>
        ) : (
          <LogsDataGrid
            columnDefs={mcpColumns}
            data={mcpLogs}
            loading={mcpLoading}
            showPagination={true}
            currentPage={mcpCurrentPage}
            totalPages={mcpTotalPages}
            pageSize={mcpPageSize}
            pageSizeOptions={pageSizeOptions}
            totalRecords={mcpFilteredRecordsCount}
            onPageChange={setMcpCurrentPage}
            onPageSizeChange={(newSize) => {
              handlePageSizeChange(newSize);
              setMcpCurrentPage(1);
            }}
            paginationRecordLabel="logs"
            gridContainerClassName="border-t border-[var(--alpha-8)]"
            emptyState={
              <DataGridEmptyState
                message={mcpSearchQuery ? 'No MCP logs match your filters' : 'No MCP logs found'}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
