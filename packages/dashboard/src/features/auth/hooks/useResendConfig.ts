import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ResendConfigSchema, UpsertResendConfigRequest } from '@insforge/shared-schemas';
import { resendConfigService } from '../services/resend-config.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useResendConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<ResendConfigSchema>({
    queryKey: ['resend-config'],
    queryFn: () => resendConfigService.getConfig(),
  });

  const updateConfigMutation = useMutation({
    mutationFn: (config: UpsertResendConfigRequest) => resendConfigService.updateConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['resend-config'] });
      showToast('Resend configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update Resend configuration', 'error');
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
