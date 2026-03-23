import { useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@insforge/ui';
import { Skeleton } from '@/components';
import { useCompute } from '../hooks/useCompute';
import { ContainerCard } from '../components/ContainerCard';
import { ContainerDetail } from '../components/ContainerDetail';
import { DeployModal } from '../components/DeployModal';

export default function ComputePage() {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);

  const {
    containers,
    deployments,
    selectedContainer,
    isLoadingContainers,
    isLoadingDeployments,
    isCreating,
    isUpdating,
    isDeleting,
    isDeploying,
    isRollingBack,
    selectContainer,
    clearSelection,
    createContainer,
    updateContainer,
    deleteContainer,
    deploy,
    rollback,
  } = useCompute();

  // Detail view
  if (selectedContainer) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        {/* Detail header */}
        <div className="flex items-center shrink-0 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <div className="flex items-center gap-3 pl-4 pr-3 py-3">
            <button
              onClick={clearSelection}
              className="flex items-center justify-center size-8 rounded border border-[var(--alpha-8)] bg-card hover:bg-[var(--alpha-8)] transition-colors"
            >
              <ArrowLeft className="size-5 text-foreground" />
            </button>
            <h1 className="text-base font-medium leading-7 text-foreground">
              {selectedContainer.name}
            </h1>
          </div>
        </div>

        {/* Detail content */}
        <div className="flex-1 min-h-0">
          <ContainerDetail
            container={selectedContainer}
            deployments={deployments}
            isLoadingDeployments={isLoadingDeployments}
            isDeploying={isDeploying}
            isDeleting={isDeleting}
            isUpdating={isUpdating}
            isRollingBack={isRollingBack}
            onDeploy={(containerId) => deploy(containerId)}
            onDelete={(id) => {
              deleteContainer(id);
            }}
            onUpdate={updateContainer}
            onRollback={rollback}
          />
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      {/* Page header */}
      <div className="flex items-center shrink-0 justify-between pl-4 pr-3 py-3 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
        <h1 className="text-base font-medium leading-7 text-foreground">Compute</h1>
        <Button
          onClick={() => setIsDeployModalOpen(true)}
          className="h-8 px-2 py-0 gap-2 bg-black text-white dark:bg-neutral-600 dark:text-white hover:bg-gray-800 dark:hover:bg-neutral-500 text-sm font-medium rounded"
        >
          <Plus className="w-4 h-4" />
          Deploy Container
        </Button>
      </div>

      {/* Table header */}
      <div className="px-3 pt-3 shrink-0">
        <div className="flex items-center h-8 pl-2 pr-2 text-sm text-muted-foreground">
          <div className="w-8 shrink-0" />
          <div className="flex-[1.5] py-1.5 px-2.5">Name</div>
          <div className="flex-[2] py-1.5 px-2.5 hidden md:block">Source</div>
          <div className="flex-[2] py-1.5 px-2.5 hidden lg:block">Endpoint</div>
          <div className="flex-1 py-1.5 px-2.5 text-right">Resources</div>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col px-3 pb-4">
          <div className="flex flex-col gap-1 pt-1">
            {isLoadingContainers ? (
              <>
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </>
            ) : containers.length > 0 ? (
              containers.map((container) => (
                <ContainerCard
                  key={container.id}
                  container={container}
                  onClick={() => selectContainer(container)}
                />
              ))
            ) : (
              /* Empty state */
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--alpha-8)] flex items-center justify-center mb-4">
                  <Plus className="w-6 h-6 text-muted-foreground" />
                </div>
                <h2 className="text-base font-medium text-foreground mb-1">No containers yet</h2>
                <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                  Deploy your first container from a GitHub repo or a Docker image.
                </p>
                <Button
                  onClick={() => setIsDeployModalOpen(true)}
                  className="h-8 px-3 gap-2 bg-black text-white dark:bg-neutral-600 dark:text-white hover:bg-gray-800 dark:hover:bg-neutral-500 text-sm font-medium rounded"
                >
                  <Plus className="w-4 h-4" />
                  Deploy Container
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Deploy modal */}
      <DeployModal
        open={isDeployModalOpen}
        onOpenChange={setIsDeployModalOpen}
        onSubmit={(data) => {
          createContainer(data);
          setIsDeployModalOpen(false);
        }}
        isSubmitting={isCreating}
      />
    </div>
  );
}
