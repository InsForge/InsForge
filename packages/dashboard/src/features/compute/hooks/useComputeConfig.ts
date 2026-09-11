import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@insforge/ui';
import type { ComputeConfig, UpdateComputeConfig } from '@insforge/shared-schemas';
import { computeServicesApi } from '#features/compute/services/compute.service';

export const COMPUTE_CONFIG_QUERY_KEY = ['compute', 'config'] as const;

export function useComputeConfig(enabled = true) {
  return useQuery<ComputeConfig>({
    queryKey: COMPUTE_CONFIG_QUERY_KEY,
    queryFn: () => computeServicesApi.getConfig(),
    enabled,
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useUpdateComputeConfig() {
  const { t } = useTranslation('chrome');
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  return useMutation<ComputeConfig, Error, UpdateComputeConfig>({
    mutationFn: (input) => computeServicesApi.updateConfig(input),
    onSuccess: (config) => {
      queryClient.setQueryData(COMPUTE_CONFIG_QUERY_KEY, config);
      showToast(t('compute.configSaved', { defaultValue: 'Compute settings saved' }), 'success');
    },
    onError: (error) => {
      showToast(
        error.message ||
          t('compute.configSaveFailed', { defaultValue: 'Failed to save compute settings' }),
        'error'
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: COMPUTE_CONFIG_QUERY_KEY });
      // Saving credentials can turn a provider on, which changes the metadata compute
      // slice, the sidebar, and whether the services list is worth fetching.
      void queryClient.invalidateQueries({ queryKey: ['metadata'] });
      void queryClient.invalidateQueries({ queryKey: ['compute', 'services'] });
    },
  });
}
