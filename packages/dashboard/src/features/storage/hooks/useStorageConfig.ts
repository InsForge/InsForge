import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';
import { storageConfigService } from '#features/storage/services/storage-config.service';
import { useToast } from '#lib/hooks/useToast';

/**
 * React Query hook for fetching and updating the storage configuration.
 * Provides config data, loading/updating states, and a mutate function.
 */
export function useStorageConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<StorageConfigSchema>({
    queryKey: ['storage-config'],
    queryFn: () => storageConfigService.getConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (input: UpdateStorageConfigRequest) => storageConfigService.updateConfig(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage-config'] });
      showToast('Storage configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update storage configuration', 'error');
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
