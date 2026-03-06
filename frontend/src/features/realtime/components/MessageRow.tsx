import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CodeBlock } from '@insforge/ui';
import { cn, formatTime } from '@/lib/utils/utils';
import type { RealtimeMessage } from '../services/realtime.service';

interface MessageRowProps {
  message: RealtimeMessage;
  className?: string;
}

export function MessageRow({ message, className }: MessageRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('rounded border border-[var(--alpha-8)] bg-card', className)}>
      {/* Row */}
      <div
        className="flex items-center rounded cursor-pointer hover:bg-[var(--alpha-8)] transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {/* Chevron */}
        <div className="w-[30px] shrink-0 flex items-center justify-center">
          <ChevronRight
            className={cn(
              'w-4 h-4 text-muted-foreground transition-transform',
              expanded && 'rotate-90'
            )}
          />
        </div>

        {/* Event Name */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <p className="text-sm leading-[18px] text-foreground truncate" title={message.eventName}>
            {message.eventName}
          </p>
        </div>

        {/* Channel */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span
            className="text-sm text-foreground leading-[18px] truncate block"
            title={message.channelName}
          >
            {message.channelName}
          </span>
        </div>

        {/* Sender Type */}
        <div className="w-[80px] shrink-0 h-12 flex items-center px-2.5">
          <span
            className={cn(
              'inline-flex items-center justify-center h-5 px-1.5 rounded-sm text-xs font-medium text-white capitalize',
              message.senderType === 'system' ? 'bg-sky-800' : 'bg-teal-700'
            )}
          >
            {message.senderType}
          </span>
        </div>

        {/* WebSockets */}
        <div className="w-[100px] shrink-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground leading-[18px]">{message.wsAudienceCount}</span>
        </div>

        {/* Webhooks */}
        <div className="w-[100px] shrink-0 h-12 flex items-center px-2.5">
          <span className="text-sm text-foreground leading-[18px]">
            {message.whDeliveredCount}/{message.whAudienceCount}
          </span>
        </div>

        {/* Sent At */}
        <div className="flex-1 min-w-0 h-12 flex items-center px-2.5">
          <span
            className="text-sm text-foreground leading-[18px] truncate"
            title={message.createdAt}
          >
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>

      {/* Expanded payload */}
      {expanded && (
        <div className="px-3 pb-3">
          <CodeBlock
            code={JSON.stringify(message.payload, null, 2)}
            label="Payload"
            variant="compact"
          />
        </div>
      )}
    </div>
  );
}
