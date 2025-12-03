import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import {
  useSocket,
  ServerEvents,
  SocketMessage,
  DataUpdatePayload,
} from '@/lib/contexts/SocketContext';
import { useRealtime } from '../hooks/useRealtime';
import { MessageRow } from '../components/MessageRow';
import RealtimeEmptyState from '../components/RealtimeEmptyState';
import type { RealtimeMessage } from '../services/realtime.service';

export default function RealtimeMessagesPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<RealtimeMessage | null>(null);

  const { messages, isLoadingMessages, refetchMessages } = useRealtime();

  const { socket, isConnected } = useSocket();

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchMessages();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Listen for real-time updates
  useEffect(() => {
    if (!socket || !isConnected) {
      return;
    }

    const handleDataUpdate = (message: SocketMessage<DataUpdatePayload>) => {
      if (message.payload?.resource === ('realtime' as DataUpdatePayload['resource'])) {
        void refetchMessages();
      }
    };

    socket.on(ServerEvents.DATA_UPDATE, handleDataUpdate);

    return () => {
      socket.off(ServerEvents.DATA_UPDATE, handleDataUpdate);
    };
  }, [socket, isConnected, refetchMessages]);

  // Message detail view
  if (selectedMessage) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex items-center gap-2.5 p-4 border-b border-border-gray dark:border-neutral-600">
          <button
            onClick={() => setSelectedMessage(null)}
            className="text-xl text-zinc-500 dark:text-neutral-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            Messages
          </button>
          <ChevronRight className="w-5 h-5 text-muted-foreground dark:text-neutral-400" />
          <p className="text-xl text-zinc-950 dark:text-white">{selectedMessage.eventName}</p>
        </div>

        <div className="flex-1 min-h-0 p-4 overflow-auto">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Channel</p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {selectedMessage.channelName}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">
                  Sender Type
                </p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {selectedMessage.senderType}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">Created</p>
                <p className="text-sm text-zinc-950 dark:text-white">{selectedMessage.createdAt}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">
                  WS Audience
                </p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {selectedMessage.wsAudienceCount}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">
                  WH Audience
                </p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {selectedMessage.whAudienceCount}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
                <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-1">
                  WH Delivered
                </p>
                <p className="text-sm text-zinc-950 dark:text-white">
                  {selectedMessage.whDeliveredCount}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-neutral-100 dark:bg-[#333333]">
              <p className="text-sm text-muted-foreground dark:text-neutral-400 mb-2">Payload</p>
              <pre className="text-sm text-zinc-950 dark:text-white font-mono whitespace-pre-wrap overflow-auto">
                {JSON.stringify(selectedMessage.payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default list view
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Messages</h1>

          {/* Separator */}
          <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

          {/* Refresh button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="p-1 h-9 w-9"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="center">
                <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex flex-col gap-2 relative">
          {/* Table Header */}
          <div className="grid grid-cols-12 px-3 text-sm text-muted-foreground dark:text-neutral-400">
            <div className="col-span-2 py-1 px-3">Event</div>
            <div className="col-span-2 py-1 px-3">Channel</div>
            <div className="col-span-1 py-1 px-3">Sender</div>
            <div className="col-span-3 py-1 px-3">Payload</div>
            <div className="col-span-1 py-1 px-3">WebSockets</div>
            <div className="col-span-1 py-1 px-3">Webhooks</div>
            <div className="col-span-2 py-1 px-3">Sent At</div>
          </div>

          {isLoadingMessages ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[8px]" />
              ))}
            </>
          ) : messages.length >= 1 ? (
            <>
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  onClick={() => setSelectedMessage(message)}
                />
              ))}
            </>
          ) : (
            <RealtimeEmptyState type="messages" />
          )}

          {/* Loading mask overlay */}
          {isRefreshing && (
            <div className="absolute inset-0 bg-white dark:bg-neutral-800 flex items-center justify-center z-50">
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 border-2 border-zinc-500 dark:border-neutral-700 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">Loading</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
