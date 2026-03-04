import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { LogsDataGrid, type LogsColumnDef } from '@/features/logs/components';
import { formatTime, cn } from '@/lib/utils/utils';
import { LOGS_PAGE_SIZE } from '@/features/logs/helpers';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { Button, ConfirmDialog } from '@insforge/ui';
import { TableHeader } from '@/components';
import { useAuditLogs, useClearAuditLogs } from '@/features/logs/hooks/useAuditLogs';
import type { GetAuditLogsRequest } from '@insforge/shared-schemas';

function ModuleBadge({ module }: { module?: string | null }) {
  return (
    <span className="inline-flex h-5 items-center rounded border border-[var(--alpha-8)] bg-[var(--alpha-8)] px-2 text-[12px] font-medium leading-4 text-[rgb(var(--muted-foreground))]">
      {module || 'general'}
    </span>
  );
}

export default function AuditsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Partial<GetAuditLogsRequest>>({});
  const { confirm, confirmDialogProps } = useConfirm();

  const offset = (currentPage - 1) * LOGS_PAGE_SIZE;

  const {
    data: logsResponse,
    isLoading,
    error,
    refetch,
  } = useAuditLogs({
    limit: LOGS_PAGE_SIZE,
    offset,
    ...filters,
  });

  const clearMutation = useClearAuditLogs();

  const handleRefresh = () => {
    void refetch();
  };

  const handleClearLogs = () => {
    void confirm({
      title: 'Clear Audit Logs',
      description:
        'Are you sure you want to clear old audit logs? This will keep the last 90 days of logs.',
      confirmText: 'Clear Logs',
      cancelText: 'Cancel',
    }).then((confirmed) => {
      if (confirmed) {
        clearMutation.mutate(90);
      }
    });
  };

  useEffect(() => {
    setCurrentPage(1);
    if (searchQuery) {
      setFilters({ actor: searchQuery });
    } else {
      setFilters({});
    }
  }, [searchQuery]);

  const logsData = logsResponse?.data || [];
  const totalRecords = logsResponse?.pagination?.total || 0;

  const columns: LogsColumnDef[] = useMemo(
    () => [
      {
        key: 'actor',
        name: 'Actor',
        width: '240px',
      },
      {
        key: 'action',
        name: 'Action',
        width: '240px',
      },
      {
        key: 'module',
        name: 'Type',
        width: '160px',
        renderCell: ({ row }) => <ModuleBadge module={String(row.module ?? '')} />,
      },
      {
        key: 'details',
        name: 'Definition',
        width: '1fr',
        minWidth: 360,
        renderCell: ({ row }) => {
          const details = row.details ? JSON.stringify(row.details) : '-';
          const timestamp = formatTime(String(row.createdAt ?? ''));

          return (
            <div className="flex w-full items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-normal leading-[18px] text-[rgb(var(--foreground))]">
                {`${timestamp} - ${details}`}
              </p>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="audits.logs"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search audit logs"
        rightActions={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleClearLogs}
              disabled={clearMutation.isPending || !logsData.length}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-hidden">
        <LogsDataGrid
          columnDefs={columns}
          data={logsData}
          loading={isLoading}
          currentPage={currentPage}
          totalPages={Math.ceil(totalRecords / LOGS_PAGE_SIZE)}
          pageSize={LOGS_PAGE_SIZE}
          totalRecords={totalRecords}
          onPageChange={setCurrentPage}
          gridContainerClassName="border-t border-[var(--alpha-8)]"
          emptyState={
            <div className="text-[13px] text-muted-foreground">
              {error
                ? `Error loading audit logs: ${error instanceof Error ? error.message : 'An unexpected error occurred'}`
                : searchQuery
                  ? 'No audit logs match your search criteria'
                  : 'No audit logs found'}
            </div>
          }
        />
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
