import { ExternalLink, MoreVertical, Play, Square, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@insforge/ui';
import type { ServiceSchema } from '@insforge/shared-schemas';
import { statusColors, getReachableUrl } from '../constants';

interface ServiceCardProps {
  service: ServiceSchema;
  onClick: () => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onClick, onStop, onStart, onDelete }: ServiceCardProps) {
  const reachableUrl = getReachableUrl(service);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onClick();
        }
      }}
      className="w-full text-left bg-card border border-[var(--alpha-8)] rounded-lg p-4 hover:border-foreground/20 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground truncate">{service.name}</h3>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusColors[service.status]}`} />
            {service.status}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-[var(--alpha-8)] hover:text-foreground"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {service.status === 'running' && (
                <DropdownMenuItem onClick={() => onStop(service.id)}>
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </DropdownMenuItem>
              )}
              {service.status === 'stopped' && (
                <DropdownMenuItem onClick={() => onStart(service.id)}>
                  <Play className="h-3.5 w-3.5" />
                  Start
                </DropdownMenuItem>
              )}
              {(service.status === 'running' || service.status === 'stopped') && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuItem onClick={() => onDelete(service.id)} className="text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-xs text-muted-foreground truncate mb-3" title={service.imageUrl}>
        {service.imageUrl === 'dockerfile' ? 'Built from Dockerfile' : service.imageUrl}
      </p>

      {reachableUrl && (
        <a
          href={reachableUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-3"
        >
          <ExternalLink className="h-3 w-3" />
          {reachableUrl}
        </a>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-[var(--alpha-8)]">
        <span>CPU: {service.cpu}</span>
        <span>Memory: {service.memory} MB</span>
        <span>{service.region}</span>
      </div>
    </div>
  );
}
