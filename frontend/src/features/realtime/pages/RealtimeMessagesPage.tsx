import { useState, useCallback, useRef } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { Skeleton, PaginationControls, TableHeader } from '@/components';
import { useRealtimeMessages } from '../hooks/useRealtimeMessages';
import { MessageRow } from '../components/MessageRow';
import RealtimeEmptyState from '../components/RealtimeEmptyState';


export default function RealtimeMessagesPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  // List view
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
                    variant="outline-muted"
                    size="icon"
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                    className="h-8 w-8"
                  >
                    <RefreshIcon className={isRefreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
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
        {/* Sticky Table Header */}
        <div className="sticky top-0 z-10 flex h-10 items-center border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))]">
          <div className="w-[30px] shrink-0" />
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Event</div>
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Channel</div>
          <div className="w-[80px] shrink-0 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sender</div>
          <div className="w-[100px] shrink-0 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">WebSockets</div>
          <div className="w-[100px] shrink-0 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Webhooks</div>
          <div className="flex-1 px-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sent At</div>
        </div>

        {/* Table Body */}
        <div className="flex flex-col pb-4">
          {isLoadingMessages ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-none border-b border-[var(--alpha-8)] bg-[rgb(var(--card))]" />
              ))}
            </>
          ) : filteredMessages.length >= 1 ? (
            <>
              {filteredMessages.map((message, index) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  isLast={index === filteredMessages.length - 1}
                />
              ))}
            </>
          ) : (
            <RealtimeEmptyState type="messages" />
          )}
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
