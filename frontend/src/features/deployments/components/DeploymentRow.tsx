import { cn, formatTime } from '@/lib/utils/utils';
import type { DeploymentSchema } from '../services/deployments.service';

interface DeploymentRowProps {
  deployment: DeploymentSchema;
  onClick?: () => void;
  className?: string;
}

const statusColors: Record<string, string> = {
  WAITING: 'bg-yellow-600',
  UPLOADING: 'bg-blue-600',
  QUEUED: 'bg-purple-600',
  BUILDING: 'bg-sky-600',
  READY: 'bg-green-600',
  ERROR: 'bg-red-600',
  CANCELED: 'bg-gray-500',
};

export function DeploymentRow({ deployment, onClick, className }: DeploymentRowProps) {
  const statusColor = statusColors[deployment.status] || 'bg-gray-500';

  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white dark:bg-[#333333] rounded-[8px] transition-all',
        onClick && 'hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* ID Column */}
        <div className="col-span-3 min-w-0 px-3 py-1.5">
          <p
            className="text-sm text-zinc-950 dark:text-white truncate font-mono"
            title={deployment.id}
          >
            {deployment.id}
          </p>
        </div>

        {/* Status Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className={cn(
              'inline-flex items-center justify-center h-5 px-2 rounded-sm text-xs font-medium text-white',
              statusColor
            )}
          >
            {deployment.status}
          </span>
        </div>

        {/* Provider Column */}
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <span className="text-sm text-muted-foreground dark:text-neutral-400 capitalize">
            {deployment.provider}
          </span>
        </div>

        {/* URL Column */}
        <div className="col-span-3 min-w-0 px-3 py-1.5">
          {deployment.url ? (
            <a
              href={
                deployment.url.startsWith('http') ? deployment.url : `https://${deployment.url}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate block"
              onClick={(e) => e.stopPropagation()}
              title={deployment.url}
            >
              {deployment.url}
            </a>
          ) : (
            <span className="text-sm text-muted-foreground dark:text-neutral-400">—</span>
          )}
        </div>

        {/* Created Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate"
            title={deployment.createdAt}
          >
            {formatTime(deployment.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
