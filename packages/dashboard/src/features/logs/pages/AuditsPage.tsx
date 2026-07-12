import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { LogsDataGrid, type LogsColumnDef } from '#features/logs/components';
import { formatTime } from '#lib/utils/utils';
import { useConfirm } from '#lib/hooks/useConfirm';
import { usePageSize } from '#lib/hooks/usePageSize';
import { Button, ConfirmDialog, cn } from '@insforge/ui';
import { DataGridEmptyState, TableHeader } from '#components';
import { useAuditLogs, useClearAuditLogs } from '#features/logs/hooks/useAuditLogs';
import type { AuditLogSchema, GetAuditLogsRequest } from '@insforge/shared-schemas';

function ModuleBadge({ module }: { module?: string | null }) {
  return (
    <span className="inline-flex h-5 items-center rounded border border-[var(--alpha-8)] bg-[var(--alpha-8)] px-2 text-[12px] font-medium leading-4 text-[rgb(var(--muted-foreground))]">
      {module || 'general'}
    </span>
  );
}

export default function AuditsPage() {
  const { t } = useTranslation('chrome');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState<Partial<GetAuditLogsRequest>>({});
  const { confirm, confirmDialogProps } = useConfirm();
  const {
    pageSize,
    pageSizeOptions,
    onPageSizeChange: handlePageSizeChange,
  } = usePageSize('audit-logs');

  const offset = (currentPage - 1) * pageSize;

  const {
    data: logsResponse,
    isLoading,
    error,
    refetch,
  } = useAuditLogs({
    limit: pageSize,
    offset,
    ...filters,
  });

  const clearMutation = useClearAuditLogs();

  const handleRefresh = () => {
    void refetch();
  };

  const handleClearLogs = () => {
    void confirm({
      title: t('logs.clearAuditLogsTitle', { defaultValue: 'Clear Audit Logs' }),
      description: t('logs.clearAuditLogsConfirm', {
        defaultValue:
          'Are you sure you want to clear old audit logs? This will keep the last 90 days of logs.',
      }),
      confirmText: t('logs.clearLogs', { defaultValue: 'Clear Logs' }),
      cancelText: t('logs.cancel', { defaultValue: 'Cancel' }),
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

  const columns: LogsColumnDef<AuditLogSchema>[] = useMemo(
    () => [
      {
        key: 'actor',
        name: t('logs.actor', { defaultValue: 'Actor' }),
        width: '240px',
      },
      {
        key: 'action',
        name: t('logs.action', { defaultValue: 'Action' }),
        width: '240px',
      },
      {
        key: 'module',
        name: t('logs.type', { defaultValue: 'Type' }),
        width: '160px',
        renderCell: ({ row }) => <ModuleBadge module={String(row.module ?? '')} />,
      },
      {
        key: 'details',
        name: t('logs.definition', { defaultValue: 'Definition' }),
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
    [t]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="audits.logs"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder={t('logs.searchAuditLogs', { defaultValue: 'Search audit logs' })}
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
          totalPages={Math.ceil(totalRecords / pageSize)}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          totalRecords={totalRecords}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            handlePageSizeChange(newSize);
            setCurrentPage(1);
          }}
          paginationRecordLabel={t('logs.recordLabel', { defaultValue: 'logs' })}
          gridContainerClassName="border-t border-[var(--alpha-8)]"
          emptyState={
            error ? (
              <div className="text-[13px] text-muted-foreground">
                {t('logs.errorLoadingAuditLogs', {
                  error:
                    error instanceof Error
                      ? error.message
                      : t('logs.unexpectedError', {
                          defaultValue: 'An unexpected error occurred',
                        }),
                  defaultValue: 'Error loading audit logs: {{error}}',
                })}
              </div>
            ) : (
              <DataGridEmptyState
                message={
                  searchQuery
                    ? t('logs.noAuditLogsMatch', {
                        defaultValue: 'No audit logs match your search criteria',
                      })
                    : t('logs.noAuditLogs', { defaultValue: 'No audit logs found' })
                }
              />
            )
          }
        />
      </div>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
