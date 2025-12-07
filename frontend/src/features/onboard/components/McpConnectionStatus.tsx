import { format } from 'date-fns';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { cn } from '@/lib/utils/utils';

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
        variant="outline"
        onClick={onConnectClick}
        className="h-9 px-4 gap-2 bg-white dark:bg-transparent text-gray-900 dark:text-white border-gray-300 dark:border-neutral-600 hover:bg-gray-100 dark:hover:bg-neutral-900 rounded-full"
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
            variant="outline"
            onClick={onConnectClick}
            className="h-9 px-4 gap-2 bg-white dark:bg-transparent text-gray-900 dark:text-white border-gray-300 dark:border-neutral-600 hover:bg-gray-100 dark:hover:bg-neutral-900 rounded-full"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm">Connected</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          sideOffset={8}
          className={cn(
            'bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700',
            'text-gray-700 dark:text-neutral-300 p-3 max-w-[280px]'
          )}
        >
          <p className="text-sm">
            Last MCP call was at{' '}
            <span className="text-gray-900 dark:text-white font-medium">
              {latestRecord ? formatConnectionTime(latestRecord.created_at) : 'Unknown'}
            </span>
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
