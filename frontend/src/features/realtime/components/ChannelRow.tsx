import { cn } from '@/lib/utils/utils';
import { format } from 'date-fns';
import { Switch } from '@/components';
import type { RealtimeChannel } from '../services/realtime.service';

interface ChannelRowProps {
  channel: RealtimeChannel;
  onClick: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  isUpdating?: boolean;
  className?: string;
}

export function ChannelRow({
  channel,
  onClick,
  onToggleEnabled,
  isUpdating,
  className,
}: ChannelRowProps) {
  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Pattern Column */}
        <div className="col-span-4 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={channel.pattern}>
            {channel.pattern}
          </p>
        </div>

        {/* Description Column */}
        <div className="col-span-5 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate block"
            title={channel.description || ''}
          >
            {channel.description || '-'}
          </span>
        </div>

        {/* Enabled Toggle Column */}
        <div className="col-span-1 px-3 py-1.5">
          <Switch
            checked={channel.enabled}
            disabled={isUpdating}
            onCheckedChange={(checked) => {
              onToggleEnabled(checked);
            }}
            onClick={(e) => e.stopPropagation()}
          />
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
