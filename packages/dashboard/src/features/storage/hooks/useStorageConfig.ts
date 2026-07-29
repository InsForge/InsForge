import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';
import { storageConfigService } from '#features/storage/services/storage-config.service';
import { useToast } from '@insforge/ui';

/**
 * React Query hook for fetching and updating the storage configuration.
 * Provides config data, loading/updating states, and a mutate function.
 */
export function useStorageConfig() {
  const { t } = useTranslation('chrome');
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
      showToast(
        t('storage.configUpdatedSuccessfully', {
          defaultValue: 'Storage configuration updated successfully',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('storage.failedToUpdateConfig', {
            defaultValue: 'Failed to update storage configuration',
          }),
        'error'
      );
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
