import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CodeBlock, cn } from '@insforge/ui';
import { formatTime } from '#lib/utils/utils';
import { ListRow, ListRowCell } from '#components';
import type { RealtimeMessage } from '#features/realtime/services/realtime.service';

interface MessageRowProps {
  message: RealtimeMessage;
  className?: string;
}

export function MessageRow({ message, className }: MessageRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <ListRow
      className={className}
      onClick={() => setExpanded((prev) => !prev)}
      footer={
        expanded && (
          <div className="px-3 pb-3">
            <CodeBlock
              code={JSON.stringify(message.payload, null, 2)}
              label="Payload"
              variant="compact"
            />
          </div>
        )
      }
    >
      {/* Chevron */}
      <ListRowCell className="w-[30px] shrink-0 justify-center px-0">
        <ChevronRight
          className={cn(
            'w-4 h-4 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
      </ListRowCell>

      {/* Event Name */}
      <ListRowCell className="flex-1 min-w-0">
        <p className="text-sm leading-[18px] text-foreground truncate" title={message.eventName}>
          {message.eventName}
        </p>
      </ListRowCell>

      {/* Channel */}
      <ListRowCell className="flex-1 min-w-0">
        <span
          className="text-sm text-foreground leading-[18px] truncate block"
          title={message.channelName}
        >
          {message.channelName}
        </span>
      </ListRowCell>

      {/* Sender Type */}
      <ListRowCell className="w-[80px] shrink-0">
        <span
          className={cn(
            'inline-flex items-center justify-center h-5 px-1.5 rounded-sm text-xs font-medium text-white capitalize',
            message.senderType === 'system' ? 'bg-sky-800' : 'bg-teal-700'
          )}
        >
          {message.senderType}
        </span>
      </ListRowCell>

      {/* WebSockets */}
      <ListRowCell className="w-[100px] shrink-0">
        <span className="text-sm text-foreground leading-[18px]">{message.wsAudienceCount}</span>
      </ListRowCell>

      {/* Webhooks */}
      <ListRowCell className="w-[100px] shrink-0">
        <span className="text-sm text-foreground leading-[18px]">
          {message.whDeliveredCount}/{message.whAudienceCount}
        </span>
      </ListRowCell>

      {/* Sent At */}
      <ListRowCell className="flex-1 min-w-0">
        <span className="text-sm text-foreground leading-[18px] truncate" title={message.createdAt}>
          {formatTime(message.createdAt)}
        </span>
      </ListRowCell>
    </ListRow>
  );
}
