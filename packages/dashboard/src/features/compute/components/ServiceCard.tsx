import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, MoreVertical, Play, Square, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@insforge/ui';
import type { ServiceSchema } from '@insforge/shared-schemas';
import { statusColors, getReachableUrl } from '#features/compute/constants';
import { useServiceHealth } from '#features/compute/hooks/useComputeServices';

interface ServiceCardProps {
  service: ServiceSchema;
  onClick: () => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onClick, onStop, onStart, onDelete }: ServiceCardProps) {
  const { t } = useTranslation('chrome');
  const reachableUrl = getReachableUrl(service);
  // Only poll Fly events for services that could plausibly be crash-looping —
  // a stopped/failed/destroying machine has nothing to loop on, and these
  // calls hit Fly's per-org rate limit.
  const healthEnabled = service.status === 'running' || service.status === 'deploying';
  const { health } = useServiceHealth(service.id, healthEnabled);

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
          {health?.isCrashLooping && (
            <span
              className="flex items-center gap-1 text-xs text-destructive"
              title={t('compute.crashLoopTooltip', {
                defaultValue:
                  "{{count}} exits in the last 60s — container is restart-looping. Container stdout/stderr isn't surfaced yet; reproduce locally with the same image to see why it's exiting.",
                count: health.recentExitCount,
              })}
            >
              <AlertTriangle className="h-3 w-3" />
              {t('compute.crashLooping', { defaultValue: 'crash-looping' })}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${statusColors[service.status]}`} />
            {t(`compute.statuses.${service.status}`, { defaultValue: service.status })}
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
                  {t('compute.stop', { defaultValue: 'Stop' })}
                </DropdownMenuItem>
              )}
              {service.status === 'stopped' && (
                <DropdownMenuItem onClick={() => onStart(service.id)}>
                  <Play className="h-3.5 w-3.5" />
                  {t('compute.start', { defaultValue: 'Start' })}
                </DropdownMenuItem>
              )}
              {(service.status === 'running' || service.status === 'stopped') && (
                <DropdownMenuSeparator />
              )}
              <DropdownMenuItem onClick={() => onDelete(service.id)} className="text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
                {t('compute.delete', { defaultValue: 'Delete' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <p className="text-xs text-muted-foreground truncate mb-3" title={service.imageUrl}>
        {service.imageUrl === 'dockerfile'
          ? t('compute.builtFromDockerfile', { defaultValue: 'Built from Dockerfile' })
          : service.imageUrl}
      </p>

      {reachableUrl &&
        (reachableUrl.href ? (
          <a
            href={reachableUrl.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-3"
          >
            <ExternalLink className="h-3 w-3" />
            {reachableUrl.display}
          </a>
        ) : (
          <code
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center text-xs text-foreground bg-[var(--alpha-8)] px-2 py-0.5 rounded mb-3 font-mono"
            title={t('compute.rawTcpEndpointTooltip', {
              defaultValue:
                'Raw TCP endpoint — connect with redis-cli, psql, or your protocol-native client',
            })}
          >
            {reachableUrl.display}
          </code>
        ))}

      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t border-[var(--alpha-8)]">
        <span>{t('compute.cpuValue', { defaultValue: 'CPU: {{value}}', value: service.cpu })}</span>
        <span>
          {t('compute.memoryValue', {
            defaultValue: 'Memory: {{value}} MB',
            value: service.memory,
          })}
        </span>
        <span>{service.region}</span>
      </div>
    </div>
  );
}
