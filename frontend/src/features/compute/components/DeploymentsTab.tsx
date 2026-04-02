import type { ContainerDeploymentSchema } from '@insforge/shared-schemas';
import { Badge, Button } from '@insforge/ui';
import { RotateCcw } from 'lucide-react';

interface DeploymentsTabProps {
  deployments: ContainerDeploymentSchema[];
  onRollback: (deploymentId: string) => void;
  isRollingBack: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  live: 'bg-green-500/15 text-green-500',
  pending: '',
  building: 'bg-yellow-500/15 text-yellow-500',
  pushing: 'bg-yellow-500/15 text-yellow-500',
  deploying: 'bg-blue-500/15 text-blue-500',
  failed: 'bg-red-500/15 text-red-500',
  rolled_back: 'bg-gray-500/15 text-gray-400',
};

export function DeploymentsTab({ deployments, onRollback, isRollingBack }: DeploymentsTabProps) {
  if (deployments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No deployments yet. Deploy your container to get started.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {deployments.map((dep) => (
        <div
          key={dep.id}
          className="flex items-center justify-between rounded-md border border-border px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Badge className={`capitalize shrink-0 ${STATUS_COLORS[dep.status] ?? ''}`}>
              {dep.status.replace(/_/g, ' ')}
            </Badge>
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate font-mono">
                {dep.imageUri ?? dep.imageTag ?? 'pending...'}
              </p>
              <p className="text-xs text-muted-foreground">
                {dep.triggeredBy.replace(/_/g, ' ')} &middot;{' '}
                {new Date(dep.createdAt).toLocaleString()}
              </p>
              {dep.errorMessage && (
                <p className="text-xs text-destructive mt-0.5 truncate">{dep.errorMessage}</p>
              )}
            </div>
          </div>

          {dep.status === 'live' && dep.imageUri && (
            <span className="text-xs text-green-600 font-medium px-2 shrink-0">Active</span>
          )}

          {dep.status !== 'live' && dep.imageUri && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRollback(dep.id)}
              disabled={isRollingBack}
              className="shrink-0 ml-2"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Rollback
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
