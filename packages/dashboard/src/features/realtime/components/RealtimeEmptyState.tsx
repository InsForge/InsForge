import { useTranslation } from 'react-i18next';
import { Radio, Plus } from 'lucide-react';
import { Button } from '@insforge/ui';

interface RealtimeEmptyStateProps {
  type: 'channels' | 'messages';
  onCreateChannel?: () => void;
}

export default function RealtimeEmptyState({ type, onCreateChannel }: RealtimeEmptyStateProps) {
  const { t } = useTranslation('chrome');
  const content = {
    channels: {
      title: t('realtime.noChannelsAvailable', { defaultValue: 'No channels available' }),
      description: t('realtime.noChannelsDescription', {
        defaultValue: 'Create a channel to start receiving realtime events',
      }),
    },
    messages: {
      title: t('realtime.noMessagesYet', { defaultValue: 'No messages yet' }),
      description: t('realtime.noMessagesDescription', {
        defaultValue: 'Messages will appear here when events are published to channels',
      }),
    },
  };

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-[8px] bg-neutral-100 dark:bg-[#333333]">
      <Radio size={40} className="text-neutral-400 dark:text-neutral-600" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">{content[type].title}</p>
        <p className="text-neutral-500 dark:text-neutral-400 text-xs">
          {content[type].description}
        </p>
      </div>
      {type === 'channels' && onCreateChannel && (
        <Button
          onClick={onCreateChannel}
          className="h-8 rounded px-2 flex items-center gap-1.5 mt-1"
        >
          <Plus className="size-4" />
          {t('realtime.addChannel', { defaultValue: 'Add Channel' })}
        </Button>
      )}
    </div>
  );
}
