import { useState } from 'react';
import {
  ContainerSchema,
  ContainerDeploymentSchema,
  UpdateContainerRequest,
} from '@insforge/shared-schemas';
import { Button } from '@insforge/ui';
import { Trash2, RefreshCw, ExternalLink } from 'lucide-react';
import { EnvVarsTab } from './EnvVarsTab';
import { DeploymentsTab } from './DeploymentsTab';

type Tab = 'overview' | 'envvars' | 'deployments';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  building: 'bg-yellow-500',
  deploying: 'bg-blue-500',
  pending: 'bg-gray-400',
  stopped: 'bg-gray-500',
  failed: 'bg-red-500',
};

interface ContainerDetailProps {
  container: ContainerSchema;
  deployments: ContainerDeploymentSchema[];
  isLoadingDeployments: boolean;
  isDeploying: boolean;
  isDeleting: boolean;
  isUpdating: boolean;
  isRollingBack: boolean;
  onDeploy: (containerId: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (params: { id: string; data: UpdateContainerRequest }) => void;
  onRollback: (params: { containerId: string; deploymentId: string }) => void;
}

export function ContainerDetail({
  container,
  deployments,
  isLoadingDeployments,
  isDeploying,
  isDeleting,
  isUpdating,
  isRollingBack,
  onDeploy,
  onDelete,
  onUpdate,
  onRollback,
}: ContainerDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const statusColor = STATUS_COLORS[container.status] ?? 'bg-gray-400';

  const source =
    container.source_type === 'github'
      ? `${container.github_repo ?? ''}@${container.github_branch ?? 'main'}`
      : (container.image_url ?? '—');

  const handleSaveEnvVars = (vars: { key: string; value: string }[]) => {
    const envVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    onUpdate({ id: container.id, data: { envVars } });
  };

  const handleSaveAndRedeploy = (vars: { key: string; value: string }[]) => {
    const envVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    onUpdate({ id: container.id, data: { envVars } });
    onDeploy(container.id);
  };

  const handleRollback = (deploymentId: string) => {
    onRollback({ containerId: container.id, deploymentId });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Container header info */}
      <div className="px-6 pt-4 pb-2 border-b border-[var(--alpha-8)] shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`} />
          <span className="text-sm capitalize text-muted-foreground">{container.status}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-muted-foreground font-mono">{source}</p>
          {container.endpoint_url && (
            <a
              href={container.endpoint_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {container.endpoint_url}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--alpha-8)] shrink-0 px-6">
        {(['overview', 'envvars', 'deployments'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'overview' ? 'Overview' : tab === 'envvars' ? 'Env Vars' : 'Deployments'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        {activeTab === 'overview' && (
          <div className="flex flex-col gap-6 max-w-2xl">
            {/* Source info */}
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-foreground">Source</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <span className="text-muted-foreground">Type</span>
                <span className="text-foreground capitalize">{container.source_type}</span>
                {container.source_type === 'github' ? (
                  <>
                    <span className="text-muted-foreground">Repository</span>
                    <span className="text-foreground font-mono">
                      {container.github_repo ?? '—'}
                    </span>
                    <span className="text-muted-foreground">Branch</span>
                    <span className="text-foreground font-mono">
                      {container.github_branch ?? '—'}
                    </span>
                    <span className="text-muted-foreground">Dockerfile</span>
                    <span className="text-foreground font-mono">
                      {container.dockerfile_path ?? '—'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Image</span>
                    <span className="text-foreground font-mono truncate">
                      {container.image_url ?? '—'}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Resources */}
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-foreground">Resources</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <span className="text-muted-foreground">CPU</span>
                <span className="text-foreground">{container.cpu} vCPU units</span>
                <span className="text-muted-foreground">Memory</span>
                <span className="text-foreground">{container.memory} MB</span>
                <span className="text-muted-foreground">Replicas</span>
                <span className="text-foreground">{container.replicas}</span>
                <span className="text-muted-foreground">Port</span>
                <span className="text-foreground">{container.port}</span>
                {container.health_check_path && (
                  <>
                    <span className="text-muted-foreground">Health Check</span>
                    <span className="text-foreground font-mono">{container.health_check_path}</span>
                  </>
                )}
                <span className="text-muted-foreground">Region</span>
                <span className="text-foreground">{container.region}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => onDeploy(container.id)}
                disabled={isDeploying}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isDeploying ? 'animate-spin' : ''}`} />
                {isDeploying ? 'Deploying...' : 'Redeploy'}
              </Button>
              <Button
                variant="outline"
                onClick={() => onDelete(container.id)}
                disabled={isDeleting}
                className="gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/20"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        )}

        {activeTab === 'envvars' && (
          <div className="max-w-2xl">
            <EnvVarsTab
              onSave={handleSaveEnvVars}
              onSaveAndRedeploy={handleSaveAndRedeploy}
              isSaving={isUpdating}
            />
          </div>
        )}

        {activeTab === 'deployments' && (
          <DeploymentsTab
            deployments={deployments}
            isLoading={isLoadingDeployments}
            isRollingBack={isRollingBack}
            onRollback={handleRollback}
          />
        )}
      </div>
    </div>
  );
}
