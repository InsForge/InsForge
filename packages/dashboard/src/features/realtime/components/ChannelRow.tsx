import { useTranslation } from 'react-i18next';
import { formatDate } from '#lib/utils/utils';
import { Trash2 } from 'lucide-react';
import { Switch } from '@insforge/ui';
import { ListRow, ListRowCell } from '#components';
import type { RealtimeChannel } from '#features/realtime/services/realtime.service';

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
  const { t } = useTranslation('chrome');
  return (
    <ListRow className={className} contentClassName="pl-1.5" onClick={onClick}>
      {/* Toggle Switch */}
      <ListRowCell className="w-[62px] shrink-0">
        <Switch
          checked={channel.enabled}
          disabled={isUpdating}
          onCheckedChange={(checked) => {
            onToggleEnabled(checked);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </ListRowCell>

      {/* Pattern Column */}
      <ListRowCell className="flex-1 min-w-0">
        <p className="text-sm leading-[18px] text-foreground truncate" title={channel.pattern}>
          {channel.pattern}
        </p>
      </ListRowCell>

      {/* Description Column */}
      <ListRowCell className="flex-[2.5] min-w-0">
        <span
          className="text-sm text-foreground leading-[18px] truncate block"
          title={channel.description || ''}
        >
          {channel.description || '-'}
        </span>
      </ListRowCell>

      {/* Created Column */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground leading-[18px] truncate" title={channel.createdAt}>
          {formatDate(channel.createdAt)}
        </span>
      </ListRowCell>

      {/* Delete Button - hidden by default, visible on hover */}
      <ListRowCell className="w-[52px] shrink-0 justify-center px-0">
        <button
          className="flex items-center justify-center size-8 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--alpha-8)] transition-all disabled:opacity-50"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={isDeleting}
          aria-label={t('realtime.deleteChannel', { defaultValue: 'Delete channel' })}
        >
          <Trash2 className="size-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      </ListRowCell>
    </ListRow>
  );
}
