import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { UpdateRealtimeConfigRequest } from '@insforge/shared-schemas';
import { realtimeService } from '#features/realtime/services/realtime.service';
import { useToast } from '@insforge/ui';

const REALTIME_CONFIG_QUERY_KEY = ['realtime', 'config'] as const;
const REALTIME_STATS_QUERY_KEY = ['realtime', 'stats'] as const;

export function useRealtimeConfig() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: REALTIME_CONFIG_QUERY_KEY,
    queryFn: () => realtimeService.getRealtimeConfig(),
    staleTime: 2 * 60 * 1000,
  });

  const updateRealtimeConfigMutation = useMutation({
    mutationFn: (nextConfig: UpdateRealtimeConfigRequest) =>
      realtimeService.updateRealtimeConfig(nextConfig),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: REALTIME_CONFIG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: REALTIME_STATS_QUERY_KEY }),
      ]);
      showToast(
        t('realtime.retentionSettingsSaved', {
          defaultValue: 'Retention settings saved successfully.',
        }),
        'success'
      );
    },
    onError: (mutationError: Error) => {
      showToast(
        mutationError.message ||
          t('realtime.failedToSaveRetentionSettings', {
            defaultValue: 'Failed to save retention settings.',
          }),
        'error'
      );
    },
  });

  return {
    config,
    isLoading,
    isUpdating: updateRealtimeConfigMutation.isPending,
    error,
    updateConfig: updateRealtimeConfigMutation.mutateAsync,
    refetch,
  };
}
