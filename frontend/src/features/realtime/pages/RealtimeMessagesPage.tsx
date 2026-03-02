import { useState, useCallback, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { Skeleton, PaginationControls, TableHeader } from '@/components';
import { useRealtimeMessages } from '../hooks/useRealtimeMessages';
import { MessageRow } from '../components/MessageRow';
import RealtimeEmptyState from '../components/RealtimeEmptyState';
import type { RealtimeMessage } from '../services/realtime.service';

export default function RealtimeMessagesPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<RealtimeMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setIsScrolled(scrollRef.current.scrollTop > 0);
    }
  }, []);

  const {
    messages,
    isLoadingMessages,
    refetchMessages,
    messagesCurrentPage,
    messagesTotalPages,
    messagesTotalCount,
    messagesPageSize,
    setMessagesPage,
  } = useRealtimeMessages();

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const filteredMessages = searchQuery
    ? messages.filter(
        (msg) =>
          msg.eventName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          msg.channelName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchMessages();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Message detail view
  if (selectedMessage) {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
          <button
            onClick={() => setSelectedMessage(null)}
            className="text-base font-medium leading-7 text-muted-foreground hover:text-foreground transition-colors"
          >
            Messages
          </button>
          <ChevronRight className="w-5 h-5 text-muted-foreground" />
          <p className="text-base font-medium leading-7 text-foreground">
            {selectedMessage.eventName}
          </p>
        </div>

        <div className="flex-1 min-h-0 p-4 overflow-auto">
          <div className="mx-auto max-w-[1024px] w-4/5 space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">Channel</p>
                <p className="text-sm text-foreground">{selectedMessage.channelName}</p>
              </div>
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">Sender Type</p>
                <p className="text-sm text-foreground">{selectedMessage.senderType}</p>
              </div>
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">Created</p>
                <p className="text-sm text-foreground">{selectedMessage.createdAt}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">WebSockets Audience</p>
                <p className="text-sm text-foreground">{selectedMessage.wsAudienceCount}</p>
              </div>
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">Webhooks Audience</p>
                <p className="text-sm text-foreground">{selectedMessage.whAudienceCount}</p>
              </div>
              <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
                <p className="text-sm text-muted-foreground mb-1">Webhooks Delivered</p>
                <p className="text-sm text-foreground">{selectedMessage.whDeliveredCount}</p>
              </div>
            </div>

            <div className="p-4 rounded border border-[var(--alpha-8)] bg-card">
              <p className="text-sm text-muted-foreground mb-2">Payload</p>
              <pre className="text-sm text-foreground font-mono whitespace-pre-wrap overflow-auto">
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
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        className="min-w-[800px]"
        leftContent={
          <div className="flex flex-1 items-center overflow-clip">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">Messages</h1>
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              <div className="h-5 w-px bg-[var(--alpha-8)]" />
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                  >
                    <RefreshIcon className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        }
        searchValue={searchQuery}
        onSearchChange={handleSearchChange}
        searchDebounceTime={300}
        searchPlaceholder="Search message"
      />

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto relative"
      >
        {/* Top spacing */}
        <div className="h-10" />

        {/* Sticky Table Header */}
        <div
          className={`sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3 ${isScrolled ? 'border-b border-[var(--alpha-8)]' : ''}`}
        >
          <div className="mx-auto max-w-[1024px] w-4/5">
            <div className="flex items-center h-8 text-sm text-muted-foreground">
              <div className="w-[30px] shrink-0" />
              <div className="flex-1 py-1.5 px-2.5">Event</div>
              <div className="flex-1 py-1.5 px-2.5">Channel</div>
              <div className="w-[80px] shrink-0 py-1.5 px-2.5">Sender</div>
              <div className="w-[100px] shrink-0 py-1.5 px-2.5">WebSockets</div>
              <div className="w-[100px] shrink-0 py-1.5 px-2.5">Webhooks</div>
              <div className="flex-1 py-1.5 px-2.5">Sent At</div>
            </div>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex flex-col items-center px-3 pb-4">
          <div className="max-w-[1024px] w-4/5 flex flex-col gap-1 pt-1">
            {isLoadingMessages ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </>
            ) : filteredMessages.length >= 1 ? (
              <>
                {filteredMessages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </>
            ) : (
              <RealtimeEmptyState type="messages" />
            )}
          </div>
        </div>

        {/* Loading mask overlay */}
        {isRefreshing && (
          <div className="absolute inset-0 bg-[rgb(var(--semantic-1))] flex items-center justify-center z-50">
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">Loading</span>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredMessages.length > 0 && (
        <div className="shrink-0">
          <PaginationControls
            currentPage={messagesCurrentPage}
            totalPages={messagesTotalPages}
            onPageChange={setMessagesPage}
            totalRecords={messagesTotalCount}
            pageSize={messagesPageSize}
            recordLabel="messages"
          />
        </div>
      )}
    </div>
  );
}
