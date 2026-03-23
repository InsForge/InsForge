import { ContainerSchema } from '@insforge/shared-schemas';
import { ExternalLink } from 'lucide-react';

interface ContainerCardProps {
  container: ContainerSchema;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-500',
  building: 'bg-yellow-500',
  deploying: 'bg-blue-500',
  pending: 'bg-gray-400',
  stopped: 'bg-gray-500',
  failed: 'bg-red-500',
};

export function ContainerCard({ container, onClick }: ContainerCardProps) {
  const statusColor = STATUS_COLORS[container.status] ?? 'bg-gray-400';

  const source =
    container.sourceType === 'github'
      ? container.githubRepo
        ? `${container.githubRepo}@${container.githubBranch ?? 'main'}`
        : 'GitHub (unconfigured)'
      : (container.imageUrl ?? 'Image (unconfigured)');

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center h-12 pl-2 pr-3 rounded bg-card border border-[var(--alpha-8)] hover:bg-[var(--alpha-4)] transition-colors"
    >
      {/* Status dot */}
      <div className="flex items-center justify-center w-8 shrink-0">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor}`} />
      </div>

      {/* Name */}
      <div className="flex-[1.5] py-1.5 px-2.5 truncate">
        <span className="text-sm font-medium text-foreground">{container.name}</span>
      </div>

      {/* Source */}
      <div className="flex-[2] py-1.5 px-2.5 truncate hidden md:block">
        <span className="text-sm text-muted-foreground font-mono">{source}</span>
      </div>

      {/* Endpoint */}
      <div className="flex-[2] py-1.5 px-2.5 truncate hidden lg:flex items-center gap-1">
        {container.endpointUrl ? (
          <>
            <span className="text-sm text-muted-foreground font-mono truncate">
              {container.endpointUrl}
            </span>
            <ExternalLink className="shrink-0 w-3.5 h-3.5 text-muted-foreground" />
          </>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>

      {/* Resources */}
      <div className="flex-1 py-1.5 px-2.5 text-right shrink-0">
        <span className="text-xs text-muted-foreground">
          {container.cpu}CPU / {container.memory}MB
        </span>
      </div>
    </button>
  );
}
