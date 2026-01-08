import { useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  PaginationControls,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { useDeployments } from '../hooks/useDeployments';
import { DeploymentRow } from '../components/DeploymentRow';
import DeploymentsEmptyState from '../components/DeploymentsEmptyState';
import type { DeploymentSchema } from '../services/deployments.service';
import { formatTime } from '@/lib/utils/utils';

const statusColors: Record<string, string> = {
  WAITING: 'bg-yellow-600',
  UPLOADING: 'bg-blue-600',
  QUEUED: 'bg-purple-600',
  BUILDING: 'bg-sky-600',
  READY: 'bg-green-600',
  ERROR: 'bg-red-600',
  CANCELED: 'bg-gray-500',
};

export default function DeploymentsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentSchema | null>(null);

  const {
    deployments,
    totalDeployments,
    isLoadingDeployments,
    refetchDeployments,
    syncDeployment,
    cancelDeployment,
    isSyncing,
    isCancelling,
    pageSize,
    currentPage,
    totalPages,
    setPage,
  } = useDeployments();

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
    if (confirm('Are you sure you want to cancel this deployment?')) {
      cancelDeployment(id);
      setSelectedDeployment(null);
    }
  };

  // Deployment detail view
  if (selectedDeployment) {
    const statusColor = statusColors[selectedDeployment.status] || 'bg-gray-500';
    const canCancel = ['WAITING', 'UPLOADING', 'QUEUED', 'BUILDING'].includes(
      selectedDeployment.status
    );
    const canSync = selectedDeployment.providerDeploymentId !== null;

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2.5 p-4 border-b border-border-gray dark:border-neutral-600">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSelectedDeployment(null)}
              className="text-xl text-zinc-500 dark:text-neutral-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
            >
              Deployments
            </button>
            <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-neutral-400" />
            <p className="text-xl text-zinc-950 dark:text-white font-mono">
              {selectedDeployment.id}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {canSync && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSync(selectedDeployment.id)}
                disabled={isSyncing}
              >
                {isSyncing ? 'Syncing...' : 'Sync Status'}
              </Button>
            )}
            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleCancel(selectedDeployment.id)}
                disabled={isCancelling}
              >
                {isCancelling ? 'Cancelling...' : 'Cancel'}
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 p-4 overflow-auto">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">ID</p>
                <p className="text-sm text-zinc-950 dark:text-white font-mono break-all">
                  {selectedDeployment.id}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Status</p>
                <span
                  className={`inline-flex items-center justify-center h-5 px-2 rounded-sm text-xs font-medium text-white ${statusColor}`}
                >
                  {selectedDeployment.status}
                </span>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Provider</p>
                <p className="text-sm text-zinc-950 dark:text-white capitalize">
                  {selectedDeployment.provider}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">
                  Provider Deployment ID
                </p>
                <p className="text-sm text-zinc-950 dark:text-white font-mono break-all">
                  {selectedDeployment.providerDeploymentId || '—'}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Created</p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {formatTime(selectedDeployment.createdAt)}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Updated</p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {formatTime(selectedDeployment.updatedAt)}
                </p>
              </div>
            </div>

            {selectedDeployment.url && (
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-2">URL</p>
                <a
                  href={
                    selectedDeployment.url.startsWith('http')
                      ? selectedDeployment.url
                      : `https://${selectedDeployment.url}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  {selectedDeployment.url}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {selectedDeployment.metadata && Object.keys(selectedDeployment.metadata).length > 0 && (
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-2">Metadata</p>
                <pre className="text-sm text-zinc-950 dark:text-white font-mono whitespace-pre-wrap overflow-auto">
                  {JSON.stringify(selectedDeployment.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default list view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Fixed Page Header */}
      <div className="shrink-0 flex items-center gap-3 p-4 pb-0">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Deployments</h1>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

        {/* Refresh button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="p-1 h-9 w-9"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
              >
                <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Fixed Table Header */}
      <div className="shrink-0 grid grid-cols-12 px-7 pt-6 pb-2 text-sm text-muted-foreground dark:text-neutral-400">
        <div className="col-span-3 py-1 px-3">ID</div>
        <div className="col-span-2 py-1 px-3">Status</div>
        <div className="col-span-2 py-1 px-3">Provider</div>
        <div className="col-span-3 py-1 px-3">URL</div>
        <div className="col-span-2 py-1 px-3">Created</div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 relative">
        <div className="flex flex-col gap-2">
          {isLoadingDeployments ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[8px]" />
              ))}
            </>
          ) : deployments.length >= 1 ? (
            <>
              {deployments.map((deployment) => (
                <DeploymentRow
                  key={deployment.id}
                  deployment={deployment}
                  onClick={() => setSelectedDeployment(deployment)}
                />
              ))}
            </>
          ) : (
            <DeploymentsEmptyState />
          )}
        </div>

        {/* Loading mask overlay */}
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
      {deployments.length > 0 && (
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
    </div>
  );
}
