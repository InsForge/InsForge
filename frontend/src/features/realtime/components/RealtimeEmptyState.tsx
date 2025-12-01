import { Radio } from 'lucide-react';

interface RealtimeEmptyStateProps {
  type: 'channels' | 'messages';
}

export default function RealtimeEmptyState({ type }: RealtimeEmptyStateProps) {
  const content = {
    channels: {
      title: 'No channels available',
      description: 'Create a channel to start receiving realtime events',
    },
    messages: {
      title: 'No messages yet',
      description: 'Messages will appear here when events are published to channels',
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
    </div>
  );
}
