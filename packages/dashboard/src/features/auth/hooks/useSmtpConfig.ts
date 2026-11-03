import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SmtpConfigSchema, UpsertSmtpConfigRequest } from '@insforge/shared-schemas';
import { smtpConfigService } from '#features/auth/services/smtp-config.service';
import { useToast } from '@insforge/ui';

interface UseSmtpConfigOptions {
  enabled?: boolean;
}

export function useSmtpConfig({ enabled = true }: UseSmtpConfigOptions = {}) {
  const { t } = useTranslation('chrome');
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
    retry: 1,
    enabled,
  });

  // Mutation to update SMTP configuration
  const updateConfigMutation = useMutation({
    mutationFn: (config: UpsertSmtpConfigRequest) => smtpConfigService.updateConfig(config),
    onSuccess: (config) => {
      queryClient.setQueryData(['smtp-config'], config);
      showToast(
        t('auth.smtpConfigUpdatedToast', {
          defaultValue: 'SMTP configuration updated successfully',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('auth.smtpConfigUpdateFailed', {
            defaultValue: 'Failed to update SMTP configuration',
          }),
        'error'
      );
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
