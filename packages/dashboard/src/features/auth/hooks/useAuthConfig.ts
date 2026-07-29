import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';
import { authConfigService } from '#features/auth/services/config.service';
import { useToast } from '@insforge/ui';

export function useAuthConfig() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch auth configuration
  const {
    data: config,
    isLoading,
    error,
    refetch,
  } = useQuery<AuthConfigSchema>({
    queryKey: ['auth-config'],
    queryFn: () => authConfigService.getConfig(),
  });

  // Mutation to update auth configuration
  const updateConfigMutation = useMutation({
    mutationFn: (config: UpdateAuthConfigRequest) => authConfigService.updateConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth-config'] });
      showToast(
        t('auth.authConfigUpdatedToast', {
          defaultValue: 'Authentication configuration updated successfully',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('auth.authConfigUpdateFailed', {
            defaultValue: 'Failed to update authentication configuration',
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
