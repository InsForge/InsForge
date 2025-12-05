import { cn, formatDate } from '@/lib/utils/utils';
import { Trash2 } from 'lucide-react';
import { Switch } from '@/components';
import type { RealtimeChannel } from '../services/realtime.service';

interface ChannelRowProps {
  channel: RealtimeChannel;
  onClick: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onDelete: () => void;
  isUpdating?: boolean;
  isDeleting?: boolean;
  className?: string;
}

export function ChannelRow({
  channel,
  onClick,
  onToggleEnabled,
  onDelete,
  isUpdating,
  isDeleting,
  className,
}: ChannelRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-lg transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Toggle Switch - matches header w-[76px] */}
      <div className="flex items-center w-[76px] shrink-0 px-3 py-1.5">
        <Switch
          checked={channel.enabled}
          disabled={isUpdating}
          onCheckedChange={(checked) => {
            onToggleEnabled(checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Pattern Column - flex-1 to match header */}
      <div className="flex-1 min-w-0 px-3 py-1.5">
        <p className="text-sm text-zinc-950 dark:text-white truncate" title={channel.pattern}>
          {channel.pattern}
        </p>
      </div>

      {/* Description Column - fixed w-[640px] to match header */}
      <div className="w-[640px] min-w-0 px-3 py-1.5">
        <span
          className="text-sm text-zinc-700 dark:text-white truncate block"
          title={channel.description || ''}
        >
          {channel.description || '-'}
        </span>
      </div>

      {/* Created Column - flex-1 to match header */}
      <div className="flex-1 min-w-0 px-3 py-1">
        <span className="text-sm text-zinc-700 dark:text-white truncate" title={channel.createdAt}>
          {formatDate(channel.createdAt)}
        </span>
      </div>

      {/* Delete Button - hidden by default, visible on hover */}
      <button
        className="flex items-center justify-center size-8 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-all disabled:opacity-50"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        disabled={isDeleting}
        aria-label="Delete channel"
      >
        <Trash2 className="size-5 text-neutral-400 group-hover:text-zinc-600 dark:group-hover:text-white transition-colors" />
      </button>
    </div>
  );
}
