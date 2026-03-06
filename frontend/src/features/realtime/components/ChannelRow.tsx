import { cn, formatDate } from '@/lib/utils/utils';
import { Trash2 } from 'lucide-react';
import { Switch } from '@insforge/ui';
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
        'group rounded border border-[var(--alpha-8)] bg-card cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {/* Inner state layer — hover overlays on top of bg-card */}
      <div className="flex items-center pl-1.5 rounded hover:bg-[var(--alpha-8)] transition-colors">
        {/* Toggle Switch */}
        <div className="flex items-center w-[62px] shrink-0 h-12 px-2.5">
          <Switch
            checked={channel.enabled}
            disabled={isUpdating}
            onCheckedChange={(checked) => {
              onToggleEnabled(checked);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {/* Pattern Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm leading-[18px] text-foreground truncate" title={channel.pattern}>
            {channel.pattern}
          </p>
        </div>

        {/* Description Column */}
        <div className="flex-[2.5] min-w-0 h-12 flex items-center px-2.5">
          <span
            className="text-sm text-foreground leading-[18px] truncate block"
            title={channel.description || ''}
          >
            {channel.description || '-'}
          </span>
        </div>

        {/* Created Column */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span
            className="text-sm text-foreground leading-[18px] truncate"
            title={channel.createdAt}
          >
            {formatDate(channel.createdAt)}
          </span>
        </div>

        {/* Delete Button - hidden by default, visible on hover */}
        <div className="w-[52px] shrink-0 flex items-center justify-center h-12">
          <button
            className="flex items-center justify-center size-8 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--alpha-8)] transition-all disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            disabled={isDeleting}
            aria-label="Delete channel"
          >
            <Trash2 className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          </button>
        </div>
      </div>
    </div>
  );
}
