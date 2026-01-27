import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { realtimeService, type RealtimeChannel } from '../services/realtime.service';
import { useToast } from '@/lib/hooks/useToast';
import type { CreateChannelRequest, UpdateChannelRequest } from '@insforge/shared-schemas';

export function useRealtimeChannels() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedChannel, setSelectedChannel] = useState<RealtimeChannel | null>(null);

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

  const selectChannel = useCallback((channel: RealtimeChannel | null) => {
    setSelectedChannel(channel);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedChannel(null);
  }, []);

  return {
    channels,
    channelsCount: channels.length,
    selectedChannel,
    isLoadingChannels,
    channelsError,
    refetchChannels,
    selectChannel,
    clearSelection,
    createChannel: createChannelMutation.mutate,
    updateChannel: updateChannelMutation.mutate,
    deleteChannel: deleteChannelMutation.mutate,
    isCreating: createChannelMutation.isPending,
    isUpdating: updateChannelMutation.isPending,
    isDeleting: deleteChannelMutation.isPending,
  };
}
