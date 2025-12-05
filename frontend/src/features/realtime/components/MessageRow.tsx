import { cn, formatTime } from '@/lib/utils/utils';
import type { RealtimeMessage } from '../services/realtime.service';

interface MessageRowProps {
  message: RealtimeMessage;
  onClick: () => void;
  className?: string;
}

export function MessageRow({ message, onClick, className }: MessageRowProps) {
  const payloadStr = JSON.stringify(message.payload);

  return (
    <div
      className={cn(
        'group h-14 px-3 bg-white hover:bg-neutral-100 dark:bg-[#333333] dark:hover:bg-neutral-700 rounded-[8px] transition-all cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="grid grid-cols-12 h-full items-center">
        {/* Event Name Column */}
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <p className="text-sm text-zinc-950 dark:text-white truncate" title={message.eventName}>
            {message.eventName}
          </p>
        </div>

        {/* Channel Column */}
        <div className="col-span-2 min-w-0 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate block"
            title={message.channelName}
          >
            {message.channelName}
          </span>
        </div>

        {/* Sender Type Column */}
        <div className="col-span-1 px-3 py-1.5">
          <span
            className={cn(
              'inline-flex items-center justify-center h-5 px-1.5 rounded-sm text-xs font-medium text-white capitalize',
              message.senderType === 'system' ? 'bg-sky-700' : 'bg-teal-700'
            )}
          >
            {message.senderType}
          </span>
        </div>

        {/* Payload Preview Column */}
        <div className="col-span-3 min-w-0 px-3 py-1.5">
          <span className="text-sm text-muted-foreground dark:text-neutral-400 truncate block">
            {payloadStr.slice(0, 50)}
            {payloadStr.length > 50 ? '...' : ''}
          </span>
        </div>

        {/* WS Audience Column */}
        <div className="col-span-1 px-3 py-1.5">
          <span className="text-sm text-muted-foreground dark:text-neutral-400">
            {message.wsAudienceCount}
          </span>
        </div>

        {/* WH Delivered Column */}
        <div className="col-span-1 px-3 py-1.5">
          <span className="text-sm text-muted-foreground dark:text-neutral-400">
            {message.whDeliveredCount}/{message.whAudienceCount}
          </span>
        </div>

        {/* Created Column */}
        <div className="col-span-2 px-3 py-1.5">
          <span
            className="text-sm text-muted-foreground dark:text-neutral-400 truncate"
            title={message.createdAt}
          >
            {formatTime(message.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
