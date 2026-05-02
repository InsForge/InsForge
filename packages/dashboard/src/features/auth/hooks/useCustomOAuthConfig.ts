import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomOAuthConfigSchema,
  CreateCustomOAuthConfigRequest,
  UpdateCustomOAuthConfigRequest,
  ListCustomOAuthConfigsResponse,
} from '@insforge/shared-schemas';
import { useToast } from '#lib/hooks/useToast';
import { customOAuthConfigService } from '#features/auth/services/custom-oauth-config.service';

export function useCustomOAuthConfig(selectedKey?: string | null) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: configs,
    isLoading: isLoadingConfigs,
    refetch: refetchConfigs,
  } = useQuery<ListCustomOAuthConfigsResponse>({
    queryKey: ['custom-oauth-configs'],
    queryFn: () => customOAuthConfigService.getAllConfigs(),
  });

  const { data: selectedConfig, isLoading: isLoadingSelectedConfig } = useQuery<
    CustomOAuthConfigSchema & { clientSecret?: string }
  >({
    queryKey: ['custom-oauth-config', selectedKey],
    queryFn: () => customOAuthConfigService.getConfigByKey(selectedKey ?? ''),
    enabled: !!selectedKey,
  });

  const createConfigMutation = useMutation({
    mutationFn: (config: CreateCustomOAuthConfigRequest) =>
      customOAuthConfigService.createConfig(config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['custom-oauth-configs'] });
      showToast('Custom OAuth provider created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create custom OAuth provider', 'error');
    },
  });

  const updateConfigMutation = useMutation({
    mutationFn: ({ key, config }: { key: string; config: UpdateCustomOAuthConfigRequest }) =>
      customOAuthConfigService.updateConfig(key, config),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['custom-oauth-configs'] });
      void queryClient.invalidateQueries({ queryKey: ['custom-oauth-config', variables.key] });
      showToast('Custom OAuth provider updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update custom OAuth provider', 'error');
    },
  });

  const deleteConfigMutation = useMutation({
    mutationFn: (key: string) => customOAuthConfigService.deleteConfig(key),
    onSuccess: (_, key) => {
      void queryClient.invalidateQueries({ queryKey: ['custom-oauth-configs'] });
      void queryClient.removeQueries({ queryKey: ['custom-oauth-config', key] });
      showToast('Custom OAuth provider deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete custom OAuth provider', 'error');
    },
  });

  return {
    configs: configs?.data ?? [],
    configsCount: configs?.count ?? 0,
    isLoadingConfigs,
    selectedConfig,
    isLoadingSelectedConfig,
    createConfig: createConfigMutation.mutate,
    updateConfig: updateConfigMutation.mutate,
    deleteConfig: deleteConfigMutation.mutate,
    isCreating: createConfigMutation.isPending,
    isUpdating: updateConfigMutation.isPending,
    isDeleting: deleteConfigMutation.isPending,
    refetchConfigs,
  };
}
