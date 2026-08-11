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
import { statusColors, getReachableUrl, INGRESS_MODES } from '#features/compute/constants';
import { useServiceHealth } from '#features/compute/hooks/useComputeServices';
import { useComputeCapabilities } from '#features/compute/hooks/useComputeCapabilities';

interface ServiceCardProps {
  service: ServiceSchema;
  onClick: () => void;
  onStop: (id: string) => void;
  onStart: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ServiceCard({ service, onClick, onStop, onStart, onDelete }: ServiceCardProps) {
  const { t } = useTranslation('chrome');
  // This service's own provider, not the deployment default. Providers coexist and
  // the backend routes per row, so a Docker service in a Fly-default deployment
  // would otherwise show the meaningless region `local`, and a Fly service in a
  // Docker-default deployment would hide the region it genuinely has.
  const { capabilities } = useComputeCapabilities(service.provider);
  const showRegion = capabilities ? capabilities.regions : true;
  const reachableUrl = getReachableUrl(service);
  // Same table the create dialog uses, so the card cannot say `port` where the
  // form said "Published host port".
  const ingressLabel =
    INGRESS_MODES.find((m) => m.value === service.ingress)?.label ?? service.ingress;
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
      <div className="flex items-center justify-between gap-2 mb-3">
        {/* min-w-0 so the name is what gives way when the badges need room; without it
            the flex child refuses to shrink and "crash-looping" wraps mid-word. */}
        <h3 className="min-w-0 text-sm font-medium text-foreground truncate" title={service.name}>
          {service.name}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {health?.isCrashLooping && (
            <span
              className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-destructive"
              title={t('compute.crashLoopTooltip', {
                defaultValue:
                  '{{count}} exits in the last 60s — the container is restart-looping. Open it and check Logs for why it exits.',
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
            className="inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline mb-3"
            title={reachableUrl.display}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {/* Truncated like the image URL above it: a `host`-ingress hostname is
                longer than a card is wide, and the full value is in the tooltip. */}
            <span className="truncate">{reachableUrl.display}</span>
          </a>
        ) : (
          <code
            onClick={(e) => e.stopPropagation()}
            className="inline-flex max-w-full items-center truncate text-xs text-foreground bg-[var(--alpha-8)] px-2 py-0.5 rounded mb-3 font-mono"
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
        {/* A single-host driver reports region 'local', which tells the reader
            nothing. Show what actually varies between services instead. */}
        {showRegion ? (
          <span>{service.region}</span>
        ) : (
          <span>
            {t(`compute.ingressModes.${service.ingress}`, { defaultValue: ingressLabel })}
          </span>
        )}
      </div>
    </div>
  );
}
