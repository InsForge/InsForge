import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  OAuthConfigSchema,
  CreateOAuthConfigRequest,
  UpdateOAuthConfigRequest,
  ListOAuthConfigsResponse,
  OAuthProvidersSchema,
} from '@insforge/shared-schemas';
import { oauthConfigService } from '../services/oauth.service';
import { useToast } from '@/lib/hooks/useToast';

export function useOAuthConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedProvider, setSelectedProvider] = useState<OAuthProvidersSchema | null>(null);

  // Query to fetch all OAuth configurations
  const {
    data: configs,
    isLoading: isLoadingConfigs,
    error: configsError,
    refetch: refetchConfigs,
  } = useQuery<ListOAuthConfigsResponse>({
    queryKey: ['oauth-configs'],
    queryFn: () => oauthConfigService.getAllConfigs(),
  });

  // Query to fetch specific provider config
  const {
    data: providerConfig,
    isLoading: isLoadingProvider,
    error: providerError,
    refetch: refetchProvider,
  } = useQuery<OAuthConfigSchema & { clientSecret?: string }>({
    queryKey: ['oauth-config', selectedProvider],
    queryFn: () => oauthConfigService.getConfigByProvider(selectedProvider ?? ''),
    enabled: configs && configs.data.some((config) => config.provider === selectedProvider),
  });

  // Mutation to create OAuth configuration
  const createConfigMutation = useMutation({
    mutationFn: (config: CreateOAuthConfigRequest) => oauthConfigService.createConfig(config),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['oauth-configs'] });
      void queryClient.invalidateQueries({ queryKey: ['oauth-config', data.provider] });
      showToast(`OAuth configuration for ${data.provider} created successfully`, 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create OAuth configuration', 'error');
    },
  });

  // Mutation to update OAuth configuration
  const updateConfigMutation = useMutation({
    mutationFn: ({ provider, config }: { provider: string; config: UpdateOAuthConfigRequest }) =>
      oauthConfigService.updateConfig(provider, config),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['oauth-configs'] });
      void queryClient.invalidateQueries({ queryKey: ['oauth-config', data.provider] });
      showToast(`OAuth configuration for ${data.provider} updated successfully`, 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update OAuth configuration', 'error');
    },
  });

  // Mutation to delete OAuth configuration
  const deleteConfigMutation = useMutation({
    mutationFn: (provider: string) => oauthConfigService.deleteConfig(provider),
    onSuccess: (_, provider) => {
      queryClient.removeQueries({ queryKey: ['oauth-configs'] });
      queryClient.removeQueries({ queryKey: ['oauth-config', provider] });
      showToast(`OAuth configuration for ${provider} deleted successfully`, 'success');
      if (selectedProvider === provider) {
        setSelectedProvider(null);
      }
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete OAuth configuration', 'error');
    },
  });

  // Helper to check if a provider is configured
  const isProviderConfigured = useCallback(
    (provider: OAuthProvidersSchema): boolean => {
      return configs?.data?.some((config) => config.provider === provider) ?? false;
    },
    [configs]
  );

  // Helper to get config for a specific provider from the list
  const getProviderConfig = useCallback(
    (provider: OAuthProvidersSchema): OAuthConfigSchema | undefined => {
      return configs?.data?.find((config) => config.provider === provider);
    },
    [configs]
  );

  return {
    // State
    configs: configs?.data ?? [],
    configsCount: configs?.count ?? 0,
    selectedProvider,
    setSelectedProvider,
    providerConfig,

    // Loading states
    isLoadingConfigs,
    isLoadingProvider,
    isCreating: createConfigMutation.isPending,
    isUpdating: updateConfigMutation.isPending,
    isDeleting: deleteConfigMutation.isPending,

    // Errors
    configsError,
    providerError,

    // Actions
    createConfig: createConfigMutation.mutate,
    updateConfig: updateConfigMutation.mutate,
    deleteConfig: deleteConfigMutation.mutate,
    refetchConfigs,
    refetchProvider,

    // Helpers
    isProviderConfigured,
    getProviderConfig,
  };
}
