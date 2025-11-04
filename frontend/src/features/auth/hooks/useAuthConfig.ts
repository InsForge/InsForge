import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';
import { authConfigService } from '../services/config.service';
import { useToast } from '@/lib/hooks/useToast';

export function useAuthConfig() {
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
      showToast('Authentication configuration updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update authentication configuration', 'error');
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
