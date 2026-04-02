import { useState } from 'react';
import { useCompute } from '../hooks/useCompute';
import { ContainerCard } from '../components/ContainerCard';
import { ContainerDetail } from '../components/ContainerDetail';
import { DeployModal } from '../components/DeployModal';
import { Button } from '@insforge/ui';
import { Plus, Container } from 'lucide-react';

export default function ComputePage() {
  const {
    containers,
    selectedContainer,
    deployments,
    taskRuns,
    isLoadingContainers,
    isLoadingTaskRuns,
    isCreating,
    isUpdating,
    isDeleting,
    isDeploying,
    isRunningTask,
    containersError,
    selectContainer,
    createContainer,
    updateContainer,
    deleteContainer,
    deploy,
    rollback,
    runTask,
    stopTask,
  } = useCompute();

  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);

  if (selectedContainer) {
    return (
      <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
        <div className="flex-1 overflow-y-auto px-10 py-10">
          <div className="mx-auto w-full max-w-[1024px]">
            <ContainerDetail
              container={selectedContainer}
              deployments={deployments}
              taskRuns={taskRuns}
              isUpdating={isUpdating}
              isDeploying={isDeploying}
              isDeleting={isDeleting}
              isLoadingTaskRuns={isLoadingTaskRuns}
              isRunningTask={isRunningTask}
              onBack={() => selectContainer(null)}
              onUpdate={updateContainer}
              onDeploy={(id) => void deploy(id)}
              onRollback={(cId, dId) => void rollback(cId, dId)}
              onDelete={(id) => {
                void deleteContainer(id).then(() => selectContainer(null));
              }}
              onRunTask={(id) => runTask(id)}
              onStopTask={(cId, rId) => stopTask(cId, rId)}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      <div className="flex-1 overflow-y-auto px-10 py-10">
        <div className="mx-auto w-full max-w-[1024px] space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Compute</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Deploy and manage Docker containers on ECS Fargate.
              </p>
            </div>
            <Button size="sm" onClick={() => setIsDeployModalOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Container
            </Button>
          </div>

          {isLoadingContainers ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-muted-foreground">Loading containers...</p>
            </div>
          ) : containersError ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-sm text-red-500">
                Failed to load containers:{' '}
                {containersError instanceof Error ? containersError.message : 'Unknown error'}
              </p>
            </div>
          ) : containers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Container className="w-10 h-10 text-muted-foreground/50 mb-4" />
              <h3 className="text-sm font-medium text-foreground">No containers</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Deploy your first container from a GitHub repository or a Docker image.
              </p>
              <Button size="sm" className="mt-4" onClick={() => setIsDeployModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1" />
                Deploy Container
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {containers.map((container) => (
                <ContainerCard
                  key={container.id}
                  container={container}
                  onClick={() => selectContainer(container)}
                  badge={container.runMode === 'task' ? 'Task' : 'Service'}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <DeployModal
        open={isDeployModalOpen}
        onOpenChange={setIsDeployModalOpen}
        onSubmit={(data) => {
          createContainer(data)
            .then(() => setIsDeployModalOpen(false))
            .catch(() => undefined);
        }}
        isSubmitting={isCreating}
      />
    </div>
  );
}
