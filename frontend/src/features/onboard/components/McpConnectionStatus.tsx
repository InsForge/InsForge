import { format } from 'date-fns';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';

const formatConnectionTime = (timestamp: string) => {
  return format(new Date(timestamp), 'MMM dd, yyyy, h:mm a');
};

interface McpConnectionStatusProps {
  onConnectClick: () => void;
}

export function McpConnectionStatus({ onConnectClick }: McpConnectionStatusProps) {
  const { hasCompletedOnboarding, latestRecord, isLoading } = useMcpUsage();

  // Don't render while loading
  if (isLoading) {
    return null;
  }

  // When not connected, show "Connect" with gray dot
  if (!hasCompletedOnboarding) {
    return (
      <Button
        variant="secondary"
        size="lg"
        onClick={onConnectClick}
        className="px-4 gap-2 rounded-full"
      >
        <div className="w-2 h-2 rounded-full bg-neutral-400" />
        <span className="text-sm">Connect</span>
      </Button>
    );
  }

  // When connected, show "Connected" with green dot and tooltip
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="lg"
            onClick={onConnectClick}
            className="px-4 gap-2 rounded-full"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm">Connected</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={8}
          className="max-w-[280px] border border-[var(--border)] bg-[rgb(var(--inverse))] p-3 text-[rgb(var(--foreground))]"
        >
          <p className="text-sm text-muted-foreground">
            Last MCP call was at{' '}
            <span className="font-medium text-foreground">
              {latestRecord ? formatConnectionTime(latestRecord.created_at) : 'Unknown'}
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
