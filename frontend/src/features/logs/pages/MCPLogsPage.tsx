import { useMemo } from 'react';
import { EmptyState, TableHeader } from '@/components';
import { LogsDataGrid, type LogsColumnDef } from '../components';
import { useMcpUsage } from '../hooks/useMcpUsage';
import { formatTime } from '@/lib/utils/utils';

export default function MCPLogsPage() {
  const {
    records: mcpLogs,
    searchQuery: mcpSearchQuery,
    setSearchQuery: setMcpSearchQuery,
    isLoading: mcpLoading,
    error: mcpError,
  } = useMcpUsage({ successFilter: null });

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
            showPagination={false}
            gridContainerClassName="border-t border-[var(--alpha-8)]"
            emptyState={
              <div className="text-[13px] text-muted-foreground">
                {mcpSearchQuery ? 'No MCP logs match your filters' : 'No MCP logs found'}
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}
