import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { realtimeService, type RealtimeChannel } from '../services/realtime.service';
import { useToast } from '@/lib/hooks/useToast';
import type {
  CreateChannelRequest,
  UpdateChannelRequest,
  ListMessagesRequest,
} from '@insforge/shared-schemas';

export function useRealtime() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedChannel, setSelectedChannel] = useState<RealtimeChannel | null>(null);

  // ============================================================================
  // Channels Query
  // ============================================================================

  const {
    data: channels = [],
    isLoading: isLoadingChannels,
    error: channelsError,
    refetch: refetchChannels,
  } = useQuery({
    queryKey: ['realtime', 'channels'],
    queryFn: () => realtimeService.listChannels(),
    staleTime: 2 * 60 * 1000,
  });

  // ============================================================================
  // Messages Query
  // ============================================================================

  const [messagesParams, setMessagesParams] = useState<ListMessagesRequest>({
    limit: 100,
    offset: 0,
  });

  const {
    data: messages = [],
    isLoading: isLoadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['realtime', 'messages', messagesParams],
    queryFn: () => realtimeService.listMessages(messagesParams),
    staleTime: 30 * 1000, // 30 seconds for messages
  });

  // ============================================================================
  // Stats Query
  // ============================================================================

  const {
    data: stats,
    isLoading: isLoadingStats,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['realtime', 'stats'],
    queryFn: () => realtimeService.getMessageStats(),
    staleTime: 60 * 1000, // 1 minute for stats
  });

  // ============================================================================
  // Channel Mutations
  // ============================================================================

  const createChannelMutation = useMutation({
    mutationFn: (data: CreateChannelRequest) => realtimeService.createChannel(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'channels'] });
      showToast('Channel created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create channel', 'error');
    },
  });

  const updateChannelMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateChannelRequest }) =>
      realtimeService.updateChannel(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'channels'] });
      showToast('Channel updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update channel', 'error');
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: (id: string) => realtimeService.deleteChannel(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'channels'] });
      showToast('Channel deleted successfully', 'success');
      if (selectedChannel?.id === id) {
        setSelectedChannel(null);
      }
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete channel', 'error');
    },
  });

  // ============================================================================
  // Actions
  // ============================================================================

  const selectChannel = useCallback((channel: RealtimeChannel | null) => {
    setSelectedChannel(channel);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedChannel(null);
  }, []);

  const filterMessages = useCallback((params: Partial<ListMessagesRequest>) => {
    setMessagesParams((prev) => ({ ...prev, ...params }));
  }, []);

  const refetch = useCallback(() => {
    void refetchChannels();
    void refetchMessages();
    void refetchStats();
  }, [refetchChannels, refetchMessages, refetchStats]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const channelsCount = useMemo(() => channels.length, [channels]);
  const messagesCount = useMemo(() => messages.length, [messages]);

  return {
    // Channels
    channels,
    channelsCount,
    selectedChannel,
    isLoadingChannels,
    channelsError,

    // Messages
    messages,
    messagesCount,
    messagesParams,
    isLoadingMessages,
    messagesError,

    // Stats
    stats,
    isLoadingStats,

    // Loading states
    isLoading: isLoadingChannels || isLoadingMessages,

    // Mutations states
    isCreating: createChannelMutation.isPending,
    isUpdating: updateChannelMutation.isPending,
    isDeleting: deleteChannelMutation.isPending,

    // Actions
    selectChannel,
    clearSelection,
    createChannel: createChannelMutation.mutate,
    updateChannel: updateChannelMutation.mutate,
    deleteChannel: deleteChannelMutation.mutate,
    filterMessages,
    refetch,
    refetchChannels,
    refetchMessages,
  };
}
