import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AIAccessConfigSchema, UpdateAIAccessConfigRequest } from '@insforge/shared-schemas';
import { aiAccessConfigService } from '@/features/ai/services/ai-access-config.service';
import { useToast } from '@/lib/hooks/useToast';

/**
 * React Query hook for fetching and updating the AI access configuration.
 * Provides config data, loading/updating states, and a mutate function.
 */
export function useAIAccessConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<AIAccessConfigSchema>({
    queryKey: ['ai', 'config'],
    queryFn: () => aiAccessConfigService.getConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (input: UpdateAIAccessConfigRequest) => aiAccessConfigService.updateConfig(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai', 'config'] });
      showToast('AI access configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update AI access configuration', 'error');
    },
  });

  return {
    config,
    isLoading,
    isUpdating: updateConfigMutation.isPending,
    error,
    updateConfig: updateConfigMutation.mutate,
    refetch,
  };
}
