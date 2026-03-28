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
    isLoadingContainers,
    isCreating,
    isUpdating,
    isDeploying,
    selectContainer,
    createContainer,
    updateContainer,
    deploy,
    rollback,
  } = useCompute();

  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);

  if (selectedContainer) {
    return (
      <ContainerDetail
        container={selectedContainer}
        deployments={deployments}
        isUpdating={isUpdating}
        isDeploying={isDeploying}
        onBack={() => selectContainer(null)}
        onUpdate={updateContainer}
        onDeploy={(id) => void deploy(id)}
        onRollback={(cId, dId) => void rollback(cId, dId)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Compute</h1>
          <p className="text-sm text-muted-foreground">
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
            />
          ))}
        </div>
      )}

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
