import { useState } from 'react';
import type {
  ContainerSchema,
  ContainerDeploymentSchema,
  UpdateContainerRequest,
} from '@insforge/shared-schemas';
import { Button, Badge, Tabs, Tab } from '@insforge/ui';
import { ArrowLeft, Rocket, ExternalLink } from 'lucide-react';
import { EnvVarsTab } from './EnvVarsTab';
import { DeploymentsTab } from './DeploymentsTab';

interface ContainerDetailProps {
  container: ContainerSchema;
  deployments: ContainerDeploymentSchema[];
  isUpdating: boolean;
  isDeploying: boolean;
  onBack: () => void;
  onUpdate: (id: string, data: UpdateContainerRequest) => Promise<unknown>;
  onDeploy: (containerId: string) => void;
  onRollback: (containerId: string, deploymentId: string) => void;
}

export function ContainerDetail({
  container,
  deployments,
  isUpdating,
  isDeploying,
  onBack,
  onUpdate,
  onDeploy,
  onRollback,
}: ContainerDetailProps) {
  const [activeTab, setActiveTab] = useState('overview');

  const handleSaveEnvVars = (vars: { key: string; value: string }[]) => {
    const envVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    void onUpdate(container.id, { envVars });
  };

  const handleSaveAndRedeploy = (vars: { key: string; value: string }[]) => {
    const envVars = Object.fromEntries(vars.map((v) => [v.key, v.value]));
    void onUpdate(container.id, { envVars }).then(() => onDeploy(container.id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{container.name}</h2>
            <p className="text-sm text-muted-foreground capitalize">
              {container.sourceType === 'github'
                ? `${container.githubRepo}@${container.githubBranch}`
                : container.imageUrl}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {container.endpointUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={container.endpointUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                Open
              </a>
            </Button>
          )}
          <Button size="sm" onClick={() => onDeploy(container.id)} disabled={isDeploying}>
            <Rocket className="w-3.5 h-3.5 mr-1" />
            {isDeploying ? 'Deploying...' : 'Deploy'}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <Tab value="overview">Overview</Tab>
        <Tab value="envvars">Environment</Tab>
        <Tab value="deployments">Deployments</Tab>
      </Tabs>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-2 gap-4 max-w-xl">
          <InfoRow label="Status">
            <Badge className="capitalize">{container.status.replace(/_/g, ' ')}</Badge>
          </InfoRow>
          <InfoRow label="Source Type" value={container.sourceType} />
          <InfoRow label="CPU" value={`${container.cpu} units`} />
          <InfoRow label="Memory" value={`${container.memory} MB`} />
          <InfoRow label="Port" value={String(container.port)} />
          <InfoRow label="Health Check" value={container.healthCheckPath} />
          <InfoRow label="Auto Deploy" value={container.autoDeploy ? 'Yes' : 'No'} />
          <InfoRow label="Created" value={new Date(container.createdAt).toLocaleDateString()} />
        </div>
      )}

      {activeTab === 'envvars' && (
        <EnvVarsTab
          onSave={handleSaveEnvVars}
          onSaveAndRedeploy={handleSaveAndRedeploy}
          isSaving={isUpdating}
        />
      )}

      {activeTab === 'deployments' && (
        <DeploymentsTab
          deployments={deployments}
          onRollback={(deploymentId) => onRollback(container.id, deploymentId)}
          isRollingBack={isDeploying}
        />
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {children ?? <p className="text-sm text-foreground">{value}</p>}
    </div>
  );
}
