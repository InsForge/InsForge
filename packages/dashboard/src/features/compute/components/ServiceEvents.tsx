import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useServiceEvents } from '#features/compute/hooks/useComputeServices';

interface ServiceEventsProps {
  serviceId: string;
}

export function ServiceEvents({ serviceId }: ServiceEventsProps) {
  const { t } = useTranslation('chrome');
  const {
    data: events = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useServiceEvents(serviceId);

  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alpha-8)]">
        <h3 className="text-sm font-medium text-foreground">
          {t('compute.events', { defaultValue: 'Events' })}
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {t('compute.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">
            {t('compute.loadingEvents', { defaultValue: 'Loading events...' })}
          </p>
        ) : isError ? (
          <p className="text-xs text-destructive">
            {t('compute.loadEventsFailed', {
              defaultValue: 'Failed to load events. Try refreshing.',
            })}
          </p>
        ) : events.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('compute.noEvents', { defaultValue: 'No events available.' })}
          </p>
        ) : (
          <pre className="text-xs font-mono text-muted-foreground space-y-0.5">
            {events.map((entry, i) => (
              <div key={i}>
                <span className="text-foreground/60">
                  {(() => {
                    const d = new Date(entry.timestamp);
                    return isNaN(d.getTime())
                      ? String(entry.timestamp)
                      : d.toISOString().replace('T', ' ').slice(0, 19);
                  })()}
                </span>
                {'  '}
                {entry.message}
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
