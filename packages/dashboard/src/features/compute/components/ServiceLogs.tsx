import { RefreshCw } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useServiceLogs } from '../hooks/useComputeServices';

interface ServiceLogsProps {
  serviceId: string;
}

export function ServiceLogs({ serviceId }: ServiceLogsProps) {
  const { data: logs = [], isLoading, isError, refetch, isFetching } = useServiceLogs(serviceId);

  return (
    <div className="bg-card border border-[var(--alpha-8)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--alpha-8)]">
        <h3 className="text-sm font-medium text-foreground">Logs</h3>
        <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-4">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading logs...</p>
        ) : isError ? (
          <p className="text-xs text-destructive">Failed to load logs. Try refreshing.</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No logs available.</p>
        ) : (
          <pre className="text-xs font-mono text-muted-foreground space-y-0.5">
            {logs.map((entry, i) => (
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
