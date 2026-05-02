import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';
import { smtpConfigService } from '#features/auth/services/smtp-config.service';
import { useToast } from '#lib/hooks/useToast';

export function useSmtpConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch SMTP configuration
  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<SmtpConfigSchema>({
    queryKey: ['smtp-config'],
    queryFn: () => smtpConfigService.getConfig(),
  });

  // Mutation to update SMTP configuration
  const updateConfigMutation = useMutation({
    mutationFn: (config: UpsertSmtpConfigRequest) => smtpConfigService.updateConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['smtp-config'] });
      showToast('SMTP configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update SMTP configuration', 'error');
    },
  });

  return {
    // Data
    config,

    // Loading states
    isLoading,
    isUpdating: updateConfigMutation.isPending,

    // Errors
    error,

    // Actions
    updateConfig: updateConfigMutation.mutate,
    refetch,
  };
}
