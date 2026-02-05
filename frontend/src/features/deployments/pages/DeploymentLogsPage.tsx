import { useState, useMemo } from 'react';
import { RefreshCw, Search, MoreVertical, RefreshCcw, XCircle } from 'lucide-react';
import {
  Button,
  Input,
  PaginationControls,
  Skeleton,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components';
import { useDeployments } from '../hooks/useDeployments';
import type { DeploymentSchema } from '../services/deployments.service';
import DeploymentsEmptyState from '../components/DeploymentsEmptyState';
import { DeploymentMetaDataDialog } from '../components/DeploymentMetaDataDialog';
import { cn, formatTime } from '@/lib/utils/utils';

type DeploymentStatus =
  | 'ALL'
  | 'WAITING'
  | 'UPLOADING'
  | 'QUEUED'
  | 'BUILDING'
  | 'READY'
  | 'ERROR'
  | 'CANCELED';

const statusOptions: { value: DeploymentStatus; label: string }[] = [
  { value: 'ALL', label: 'All Status' },
  { value: 'READY', label: 'Ready' },
  { value: 'UPLOADING', label: 'Uploading' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'BUILDING', label: 'Building' },
  { value: 'ERROR', label: 'Error' },
  { value: 'CANCELED', label: 'Canceled' },
];

const statusColors: Record<string, string> = {
  WAITING: 'bg-yellow-600',
  UPLOADING: 'bg-yellow-600',
  QUEUED: 'bg-yellow-600',
  BUILDING: 'bg-yellow-600',
  READY: 'bg-green-700',
  ERROR: 'bg-red-500',
  CANCELED: 'bg-neutral-600',
};

const statusLabels: Record<string, string> = {
  WAITING: 'Waiting',
  UPLOADING: 'Uploading',
  QUEUED: 'Queued',
  BUILDING: 'Building',
  READY: 'Ready',
  ERROR: 'Error',
  CANCELED: 'Canceled',
};

export default function DeploymentLogsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus>('ALL');
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentSchema | null>(null);

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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-6 p-4">
        {/* Title */}
        <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-[-0.1px]">
          Deployment Log
        </h1>

        {/* Filters Row */}
        <div className="flex items-center gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-80">
            <Input
              type="text"
              placeholder="Search logs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-3 pr-9 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-sm text-zinc-950 dark:text-white placeholder:text-neutral-400"
            />
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400" />
          </div>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as DeploymentStatus)}
          >
            <SelectTrigger className="w-[180px] h-9 bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700">
              <SelectValue placeholder="Status" />
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
            Refresh
          </Button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-10 px-3 text-sm text-muted-foreground dark:text-neutral-400">
          <div className="col-span-3 py-1 px-3">Deployment ID</div>
          <div className="col-span-3 py-1 px-3">Status</div>
          <div className="col-span-3 py-1 px-3">Created At</div>
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
                const statusLabel = statusLabels[deployment.status] || deployment.status;

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
                        <Badge
                          variant="outline"
                          className="h-[22px] px-2.5 bg-white dark:bg-black border-neutral-200 dark:border-neutral-700 text-xs font-medium text-zinc-950 dark:text-white shrink-0"
                        >
                          Current
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
                              Sync
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCancel(deployment.id)}>
                              <XCircle className="h-4 w-4" />
                              Cancel
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
          <div className="absolute inset-0 bg-white dark:bg-neutral-800 flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading</span>
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
            recordLabel="deployments"
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
