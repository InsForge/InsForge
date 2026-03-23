import { ContainerDeploymentSchema } from '@insforge/shared-schemas';
import { Button } from '@insforge/ui';
import { Skeleton } from '@/components';
import { RotateCcw, ExternalLink } from 'lucide-react';

interface DeploymentsTabProps {
  deployments: ContainerDeploymentSchema[];
  isLoading: boolean;
  isRollingBack: boolean;
  onRollback: (deploymentId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  live: 'bg-green-500',
  building: 'bg-yellow-500',
  pushing: 'bg-blue-400',
  deploying: 'bg-blue-500',
  pending: 'bg-gray-400',
  failed: 'bg-red-500',
};

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DeploymentsTab({
  deployments,
  isLoading,
  isRollingBack,
  onRollback,
}: DeploymentsTabProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-14 rounded" />
        ))}
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">No deployments yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pt-2">
      {deployments.map((dep, idx) => {
        const statusColor = STATUS_COLORS[dep.status] ?? 'bg-gray-400';
        const canRollback = !dep.isActive && dep.status !== 'failed';
        const deployNumber = deployments.length - idx;

        return (
          <div
            key={dep.id}
            className="flex items-center h-14 pl-3 pr-3 rounded border border-[var(--alpha-8)] bg-card"
          >
            {/* Status dot */}
            <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${statusColor}`} />

            {/* Deploy number */}
            <span className="text-sm font-mono text-muted-foreground w-12 text-right shrink-0">
              #{deployNumber}
            </span>

            {/* Active badge */}
            {dep.isActive && (
              <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                active
              </span>
            )}

            {/* Commit SHA */}
            <span className="ml-3 text-sm font-mono text-foreground truncate flex-1">
              {dep.commitSha ? dep.commitSha.slice(0, 8) : (dep.imageTag ?? '—')}
            </span>

            {/* Trigger */}
            <span className="text-xs text-muted-foreground px-2 shrink-0 hidden sm:block">
              {dep.triggeredBy.replace('_', ' ')}
            </span>

            {/* Timestamp */}
            <span className="text-xs text-muted-foreground px-2 shrink-0 hidden md:block">
              {formatDate(dep.startedAt)}
            </span>

            {/* Log link */}
            {dep.buildLogUrl && (
              <a
                href={dep.buildLogUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logs</span>
              </a>
            )}

            {/* Rollback button */}
            {canRollback && (
              <Button
                variant="outline"
                size="sm"
                disabled={isRollingBack}
                onClick={() => onRollback(dep.id)}
                className="ml-2 h-7 px-2 text-xs gap-1 shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rollback</span>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
