import type { ContainerSchema } from '@insforge/shared-schemas';
import { Badge } from '@insforge/ui';
import { ExternalLink } from 'lucide-react';

interface ContainerCardProps {
  container: ContainerSchema;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  deploying: 'bg-yellow-500',
  created: 'bg-gray-400',
  failed: 'bg-red-500',
  stopped: 'bg-gray-500',
  teardown_failed: 'bg-orange-500',
};

export function ContainerCard({ container, onClick }: ContainerCardProps) {
  const source =
    container.sourceType === 'github'
      ? container.githubRepo
        ? `${container.githubRepo}@${container.githubBranch ?? 'main'}`
        : 'GitHub (unconfigured)'
      : (container.imageUrl ?? 'Image (unconfigured)');

  return (
    <button
      onClick={onClick}
      className="flex items-center w-full text-left rounded-md border border-border bg-card px-4 py-3 hover:bg-muted/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span
          className={`shrink-0 h-2.5 w-2.5 rounded-full ${STATUS_COLORS[container.status] ?? 'bg-gray-400'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{container.name}</p>
          <p className="text-xs text-muted-foreground truncate">{source}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 ml-4">
        <Badge className="text-xs capitalize">{container.status.replace(/_/g, ' ')}</Badge>
        {container.endpointUrl && (
          <a
            href={container.endpointUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </button>
  );
}
