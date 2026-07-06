import { useState } from 'react';
import { RefreshCw, Play, Pause } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useServiceLogs } from '#features/compute/hooks/useComputeServices';

interface ServiceLogsProps {
  serviceId: string;
}

// Container stdout/stderr ("application logs"), distinct from the lifecycle
// Events panel. Loads the recent window on open; the Live toggle re-polls
// every 2s. Mirrors ServiceEvents' styling intentionally.
export function ServiceLogs({ serviceId }: ServiceLogsProps) {
  const [live, setLive] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useServiceLogs(serviceId, { live });

  const lines = data?.lines ?? [];

  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alpha-8)]">
        <h3 className="text-sm font-medium text-foreground">Logs</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {live ? 'Pause' : 'Live'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading logs...</p>
        ) : isError ? (
          <p className="text-xs text-destructive">Failed to load logs. Try refreshing.</p>
        ) : lines.length === 0 ? (
          <p className="text-xs text-muted-foreground">No logs available.</p>
        ) : (
          <pre className="text-xs font-mono text-muted-foreground space-y-0.5">
            {lines.map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`}>
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
