import { useState, useCallback, useRef } from 'react';
import { CirclePlus } from 'lucide-react';
import RefreshIcon from '#assets/icons/refresh.svg?react';
import {
  Button,
  ConfirmDialog,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { Skeleton, TableHeader } from '#components';
import { useConfirm } from '#lib/hooks/useConfirm';
import { useRealtimeChannels } from '#features/realtime/hooks/useRealtimeChannels';
import { ChannelRow } from '#features/realtime/components/ChannelRow';
import { ChannelFormDialog } from '#features/realtime/components/ChannelFormDialog';
import RealtimeEmptyState from '#features/realtime/components/RealtimeEmptyState';
import type { RealtimeChannel } from '#features/realtime/services/realtime.service';
import type { CreateChannelRequest, UpdateChannelRequest } from '@insforge/shared-schemas';

export default function RealtimeChannelsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<RealtimeChannel | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setIsScrolled(scrollRef.current.scrollTop > 0);
    }
  }, []);

  const {
    channels,
    isLoadingChannels,
    refetchChannels,
    createChannel,
    isCreating,
    updateChannel,
    isUpdating,
    deleteChannel,
    isDeleting,
  } = useRealtimeChannels();

  const { confirm, confirmDialogProps } = useConfirm();

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const filteredChannels = searchQuery
    ? channels.filter(
        (ch) =>
          ch.pattern.toLowerCase().includes(searchQuery.toLowerCase()) ||
          ch.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : channels;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchChannels();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRowClick = (channel: RealtimeChannel) => {
    setSelectedChannel(channel);
    setIsDialogOpen(true);
  };

  const handleToggleEnabled = (channel: RealtimeChannel, enabled: boolean) => {
    updateChannel({ id: channel.id, data: { enabled } });
  };

  const handleDelete = async (channel: RealtimeChannel) => {
    const shouldDelete = await confirm({
      title: 'Delete Channel',
      description: `Are you sure you want to delete the channel "${channel.pattern}"? This action cannot be undone.`,
      confirmText: 'Delete',
      destructive: true,
    });

    if (shouldDelete) {
      deleteChannel(channel.id);
    }
  };

  const handleEditSave = (id: string, data: UpdateChannelRequest) => {
    updateChannel(
      { id, data },
      {
        onSuccess: () => {
          setIsDialogOpen(false);
          setSelectedChannel(null);
        },
      }
    );
  };

  const handleCreate = (data: CreateChannelRequest) => {
    createChannel(data, {
      onSuccess: () => {
        setIsDialogOpen(false);
      },
    });
  };

  const openCreateDialog = () => {
    setSelectedChannel(null);
    setIsDialogOpen(true);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        className="min-w-[800px]"
        leftContent={
          <div className="flex flex-1 items-center overflow-clip">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">Channels</h1>
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

            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              <div className="h-5 w-px bg-[var(--alpha-8)]" />
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded px-1.5 text-primary hover:bg-[var(--alpha-4)] hover:text-primary active:bg-[var(--alpha-8)]"
              onClick={openCreateDialog}
            >
              <CirclePlus className="h-6 w-6 stroke-[1.5] text-primary" />
              <span className="px-1 text-sm font-medium leading-5">Add Channel</span>
            </Button>
          </div>
        }
        rightActions={null}
        searchValue={searchQuery}
        onSearchChange={handleSearchChange}
        searchDebounceTime={300}
        searchPlaceholder="Search channel"
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
            <div className="flex items-center pl-1.5 h-8 text-sm text-muted-foreground">
              <div className="w-[62px] shrink-0 py-1.5 px-2.5" />
              <div className="flex-1 py-1.5 px-2.5">Pattern</div>
              <div className="flex-[2.5] py-1.5 px-2.5">Description</div>
              <div className="flex-1 py-1.5 px-2.5">Created</div>
              <div className="w-[52px] shrink-0" />
            </div>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex flex-col items-center px-3 pb-4">
          <div className="max-w-[1024px] w-4/5 flex flex-col gap-1 pt-1">
            {isLoadingChannels ? (
              <>
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded" />
                ))}
              </>
            ) : filteredChannels.length >= 1 ? (
              <>
                {filteredChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    onClick={() => handleRowClick(channel)}
                    onToggleEnabled={(enabled) => handleToggleEnabled(channel, enabled)}
                    onDelete={() => void handleDelete(channel)}
                    isUpdating={isUpdating}
                    isDeleting={isDeleting}
                  />
                ))}
              </>
            ) : (
              <RealtimeEmptyState type="channels" onCreateChannel={openCreateDialog} />
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

      {/* Create/Edit Dialog */}
      <ChannelFormDialog
        mode={selectedChannel ? 'edit' : 'create'}
        channel={selectedChannel}
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setSelectedChannel(null);
          }
        }}
        onSave={handleEditSave}
        onCreate={handleCreate}
        isUpdating={selectedChannel ? isUpdating : isCreating}
      />

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
