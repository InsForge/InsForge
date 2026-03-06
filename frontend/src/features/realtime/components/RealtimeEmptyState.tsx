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
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <Radio size={40} className="text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">{content[type].title}</p>
        <p className="text-sm text-muted-foreground">{content[type].description}</p>
      </div>
    </div>
  );
}
