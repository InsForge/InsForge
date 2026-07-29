import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, MoreVertical, RefreshCcw, XCircle } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Input,
  Skeleton,
  cn,
} from '@insforge/ui';
import { PaginationControls } from '#components';
import { useDeployments } from '#features/deployments/hooks/useDeployments';
import type { DeploymentSchema } from '#features/deployments/services/deployments.service';
import DeploymentsEmptyState from '#features/deployments/components/DeploymentsEmptyState';
import { DeploymentMetaDataDialog } from '#features/deployments/components/DeploymentMetaDataDialog';
import { formatTime } from '#lib/utils/utils';

type DeploymentStatus =
  | 'ALL'
  | 'WAITING'
  | 'UPLOADING'
  | 'QUEUED'
  | 'BUILDING'
  | 'READY'
  | 'ERROR'
  | 'CANCELED';

const statusColors: Record<string, string> = {
  WAITING: 'bg-yellow-600',
  UPLOADING: 'bg-yellow-600',
  QUEUED: 'bg-yellow-600',
  BUILDING: 'bg-yellow-600',
  READY: 'bg-green-700',
  ERROR: 'bg-red-500',
  CANCELED: 'bg-neutral-600',
};

export default function DeploymentLogsPage() {
  const { t } = useTranslation('chrome');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus>('ALL');
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentSchema | null>(null);

  const translatedStatusLabels: Record<string, string> = {
    WAITING: t('deployments.deploymentStatus.WAITING', { defaultValue: 'Waiting' }),
    UPLOADING: t('deployments.deploymentStatus.UPLOADING', { defaultValue: 'Uploading' }),
    QUEUED: t('deployments.deploymentStatus.QUEUED', { defaultValue: 'Queued' }),
    BUILDING: t('deployments.deploymentStatus.BUILDING', { defaultValue: 'Building' }),
    READY: t('deployments.deploymentStatus.READY', { defaultValue: 'Ready' }),
    ERROR: t('deployments.deploymentStatus.ERROR', { defaultValue: 'Error' }),
    CANCELED: t('deployments.deploymentStatus.CANCELED', { defaultValue: 'Canceled' }),
  };

  const statusOptions: { value: DeploymentStatus; label: string }[] = [
    { value: 'ALL', label: t('deployments.allStatus', { defaultValue: 'All Status' }) },
    { value: 'READY', label: translatedStatusLabels.READY },
    { value: 'UPLOADING', label: translatedStatusLabels.UPLOADING },
    { value: 'QUEUED', label: translatedStatusLabels.QUEUED },
    { value: 'BUILDING', label: translatedStatusLabels.BUILDING },
    { value: 'ERROR', label: translatedStatusLabels.ERROR },
    { value: 'CANCELED', label: translatedStatusLabels.CANCELED },
  ];

  const {
    deployments,
    totalDeployments,
    isLoadingDeployments,
    refetchDeployments,
    pageSize,
    currentPage,
    totalPages,
    setPage,
    syncDeployment,
    cancelDeployment,
  } = useDeployments();

  // Filter deployments based on search and status
  const filteredDeployments = useMemo(() => {
    return deployments.filter((deployment) => {
      const matchesSearch =
        searchQuery === '' || deployment.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'ALL' || deployment.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [deployments, searchQuery, statusFilter]);

  // Find the latest READY deployment ID for the "Current" tag
  const latestReadyDeploymentId = useMemo(() => {
    const readyDeployment = deployments.find((d) => d.status === 'READY');
    return readyDeployment?.id ?? null;
  }, [deployments]);

  const handlePageChange = (page: number) => {
    setPage(page);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchDeployments();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSync = (id: string) => {
    syncDeployment(id);
  };

  const handleCancel = (id: string) => {
    cancelDeployment(id);
  };

  // Statuses that should not show action buttons
  const noActionStatuses = ['READY', 'WAITING', 'UPLOADING'];
  const hasActions = (status: string) => !noActionStatuses.includes(status);

  const handleRowClick = (deployment: DeploymentSchema) => {
    setSelectedDeployment(deployment);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      {/* Header */}
      <div className="flex flex-col gap-6 p-4">
        {/* Title */}
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-[-0.1px]">
          {t('deployments.deploymentLogs', { defaultValue: 'Deployment Logs' })}
        </h1>

        {/* Filters Row */}
        <div className="flex items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-80">
            <Input
              type="text"
              placeholder={t('deployments.searchLogs', { defaultValue: 'Search logs' })}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-3 pr-9"
            />
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          </div>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as DeploymentStatus)}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder={t('deployments.status', { defaultValue: 'Status' })} />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Refresh Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="h-9 px-3 text-zinc-950 dark:text-white hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            <RefreshCw className={cn('h-4 w-4 mr-1.5', isRefreshing && 'animate-spin')} />
            {t('deployments.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-10 px-3 text-sm text-muted-foreground dark:text-neutral-400">
          <div className="col-span-3 py-1 px-3">
            {t('deployments.deploymentId', { defaultValue: 'Deployment ID' })}
          </div>
          <div className="col-span-3 py-1 px-3">
            {t('deployments.status', { defaultValue: 'Status' })}
          </div>
          <div className="col-span-3 py-1 px-3">
            {t('deployments.createdAt', { defaultValue: 'Created At' })}
          </div>
          <div className="col-span-1" />
        </div>
      </div>

      {/* Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 relative">
        <div className="flex flex-col gap-2">
          {isLoadingDeployments ? (
            <>
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </>
          ) : filteredDeployments.length > 0 ? (
            <>
              {filteredDeployments.map((deployment) => {
                const isCurrent = deployment.id === latestReadyDeploymentId;
                const statusColor = statusColors[deployment.status] || 'bg-neutral-500';
                const statusLabel = translatedStatusLabels[deployment.status] || deployment.status;

                return (
                  <div
                    key={deployment.id}
                    onClick={() => handleRowClick(deployment)}
                    className="grid grid-cols-10 items-center h-12 px-3 rounded-lg bg-white dark:bg-[#333] border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                  >
                    {/* Deployment ID */}
                    <div className="col-span-3 flex items-center gap-2 px-3 overflow-hidden">
                      <span
                        className="text-sm text-zinc-950 dark:text-white truncate"
                        title={deployment.id}
                      >
                        {deployment.id}
                      </span>
                      {isCurrent && (
                        <Badge className="shrink-0">
                          {t('deployments.current', { defaultValue: 'Current' })}
                        </Badge>
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-3 px-3">
                      <span
                        className={cn(
                          'inline-flex items-center justify-center h-5 px-2 rounded text-xs font-medium text-white',
                          statusColor
                        )}
                      >
                        {statusLabel}
                      </span>
                    </div>

                    {/* Created At */}
                    <div className="col-span-3 px-3">
                      <span className="text-[13px] text-zinc-950 dark:text-white">
                        {formatTime(deployment.createdAt)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex justify-end">
                      {hasActions(deployment.status) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 p-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-600"
                            >
                              <MoreVertical className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleSync(deployment.id)}>
                              <RefreshCcw className="h-4 w-4" />
                              {t('deployments.sync', { defaultValue: 'Sync' })}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCancel(deployment.id)}>
                              <XCircle className="h-4 w-4" />
                              {t('deployments.cancel', { defaultValue: 'Cancel' })}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <DeploymentsEmptyState />
          )}
        </div>

        {/* Loading overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-[rgb(var(--semantic-1))] flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {t('deployments.loading', { defaultValue: 'Loading' })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredDeployments.length > 0 && (
        <div className="shrink-0">
          <PaginationControls
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={handlePageChange}
            totalRecords={totalDeployments}
            pageSize={pageSize}
            recordLabel={t('deployments.recordDeployments', { defaultValue: 'deployments' })}
          />
        </div>
      )}

      <DeploymentMetaDataDialog
        deployment={selectedDeployment}
        onOpenChange={(open) => !open && setSelectedDeployment(null)}
      />
    </div>
  );
}
