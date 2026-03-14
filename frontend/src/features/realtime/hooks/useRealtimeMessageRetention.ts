import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateRealtimeMessageRetentionRequest } from '@insforge/shared-schemas';
import { realtimeService } from '../services/realtime.service';
import { useToast } from '@/lib/hooks/useToast';

export function useRealtimeMessageRetention() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['realtime', 'message-retention'],
    queryFn: () => realtimeService.getMessageRetentionConfig(),
    staleTime: 60 * 1000,
  });

  const updateConfigMutation = useMutation({
    mutationFn: (data: UpdateRealtimeMessageRetentionRequest) =>
      realtimeService.updateMessageRetentionConfig(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'message-retention'] });
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'stats'] });
      void queryClient.invalidateQueries({ queryKey: ['metadata', 'full'] });
      showToast('Realtime message retention updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update realtime retention', 'error');
    },
  });

  const runCleanupMutation = useMutation({
    mutationFn: () => realtimeService.runMessageCleanup(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'messages'] });
      void queryClient.invalidateQueries({ queryKey: ['realtime', 'stats'] });
      showToast(
        result.deletedCount > 0
          ? `Deleted ${result.deletedCount} expired realtime messages`
          : 'No expired realtime messages to delete',
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to run realtime cleanup', 'error');
    },
  });

  return {
    config,
    isLoading,
    error,
    isUpdating: updateConfigMutation.isPending,
    isRunningCleanup: runCleanupMutation.isPending,
    updateConfig: updateConfigMutation.mutate,
    runCleanup: runCleanupMutation.mutate,
    refetch,
  };
}
