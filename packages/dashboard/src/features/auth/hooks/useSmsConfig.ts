import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SmsConfigSchema, UpsertSmsConfigRequest } from '@insforge/shared-schemas';
import { smsConfigService } from '#features/auth/services/sms-config.service';
import { useToast } from '@insforge/ui';

interface UseSmsConfigOptions {
  enabled?: boolean;
}

export function useSmsConfig({ enabled = true }: UseSmsConfigOptions = {}) {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch SMS configuration
  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<SmsConfigSchema>({
    queryKey: ['sms-config'],
    queryFn: () => smsConfigService.getConfig(),
    enabled,
  });

  // Mutation to update SMS configuration
  const updateConfigMutation = useMutation({
    mutationFn: (config: UpsertSmsConfigRequest) => smsConfigService.updateConfig(config),
    onSuccess: (config) => {
      queryClient.setQueryData(['sms-config'], config);
      showToast(
        t('auth.smsConfigUpdatedToast', {
          defaultValue: 'SMS configuration updated successfully',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('auth.smsConfigUpdateFailed', {
            defaultValue: 'Failed to update SMS configuration',
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
