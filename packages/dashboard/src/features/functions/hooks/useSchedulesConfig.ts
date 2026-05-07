import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SchedulesConfig } from '@insforge/shared-schemas';
import { scheduleService } from '#features/functions/services/schedule.service';
import { useToast } from '#lib/hooks/useToast';

const SCHEDULES_CONFIG_QUERY_KEY = ['schedules', 'config'] as const;

export function useSchedulesConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: SCHEDULES_CONFIG_QUERY_KEY,
    queryFn: () => scheduleService.getSchedulesConfig(),
    staleTime: 2 * 60 * 1000,
  });

  const updateSchedulesConfigMutation = useMutation({
    mutationFn: (nextConfig: SchedulesConfig) => scheduleService.updateSchedulesConfig(nextConfig),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SCHEDULES_CONFIG_QUERY_KEY });
      showToast('Schedules settings saved successfully.', 'success');
    },
    onError: (mutationError: Error) => {
      showToast(mutationError.message || 'Failed to save schedules settings.', 'error');
    },
  });

  return {
    config,
    isLoading,
    isUpdating: updateSchedulesConfigMutation.isPending,
    error,
    updateConfig: updateSchedulesConfigMutation.mutateAsync,
    refetch,
  };
}
