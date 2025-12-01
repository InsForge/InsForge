import { cn } from '@/lib/utils/utils';
import { format } from 'date-fns';
import type { RealtimeChannel } from '../services/realtime.service';

interface ChannelRowProps {
  channel: RealtimeChannel;
  onClick: () => void;
  className?: string;
}

export function ChannelRow({ channel, onClick, className }: ChannelRowProps) {
  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Name Column */}
        <div className="col-span-3 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={channel.name}>
            {channel.name}
          </p>
        </div>

        {/* Description Column */}
        <div className="col-span-4 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate"
            title={channel.description || ''}
          >
            {channel.description || '-'}
          </span>
        </div>

        {/* Webhooks Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span className="text-sm text-muted-foreground dark:text-neutral-400">
            {channel.webhookUrls?.length || 0} webhooks
          </span>
        </div>

        {/* Status Column */}
        <div className="col-span-1 px-3 py-1.5">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
              channel.enabled
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-400'
            )}
          >
            {channel.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>

        {/* Created Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate"
            title={channel.createdAt}
          >
            {format(new Date(channel.createdAt), 'MMM dd, yyyy')}
          </span>
        </div>
      </div>
    </div>
  );
}
