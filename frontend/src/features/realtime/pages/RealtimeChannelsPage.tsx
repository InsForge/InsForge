import { useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  ConfirmDialog,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useRealtime } from '../hooks/useRealtime';
import { ChannelRow } from '../components/ChannelRow';
import { EditChannelModal } from '../components/EditChannelModal';
import RealtimeEmptyState from '../components/RealtimeEmptyState';
import type { RealtimeChannel } from '../services/realtime.service';

export default function RealtimeChannelsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<RealtimeChannel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    channels,
    isLoadingChannels,
    refetchChannels,
    updateChannel,
    isUpdating,
    deleteChannel,
    isDeleting,
  } = useRealtime();

  const { confirm, confirmDialogProps } = useConfirm();

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
    setIsModalOpen(true);
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

  const handleModalSave = (id: string, data: Parameters<typeof updateChannel>[0]['data']) => {
    updateChannel(
      { id, data },
      {
        onSuccess: () => {
          setIsModalOpen(false);
          setSelectedChannel(null);
        },
      }
    );
  };
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Channels</h1>

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
          <div className="flex items-center pl-3 pr-[44px] text-sm text-muted-foreground dark:text-neutral-400">
            <div className="w-[76px] shrink-0 py-1 px-3">Enabled</div>
            <div className="flex-1 py-1 px-3">Pattern</div>
            <div className="w-[640px] py-1 px-3">Description</div>
            <div className="flex-1 py-1 px-3">Created</div>
          </div>

          {isLoadingChannels ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[8px]" />
              ))}
            </>
          ) : channels.length >= 1 ? (
            <>
              {channels.map((channel) => (
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
            <RealtimeEmptyState type="channels" />
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

      <EditChannelModal
        channel={selectedChannel}
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);
          if (!open) {
            setSelectedChannel(null);
          }
        }}
        onSave={handleModalSave}
        isUpdating={isUpdating}
      />

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
