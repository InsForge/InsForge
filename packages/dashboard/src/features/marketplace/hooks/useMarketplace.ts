import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@insforge/ui';
import { marketplaceService } from '#features/marketplace/services/marketplace.service';

export const marketplaceQueryKeys = {
  plugins: ['marketplace', 'plugins'] as const,
};

export function useMarketplace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: plugins = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: marketplaceQueryKeys.plugins,
    queryFn: () => marketplaceService.listPlugins(),
    staleTime: 2 * 60 * 1000,
  });

  // Installs create/remove a project secret, so the Secrets page cache is
  // stale after either mutation
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: marketplaceQueryKeys.plugins }),
      queryClient.invalidateQueries({ queryKey: ['secrets'] }),
    ]);

  const installMutation = useMutation({
    mutationFn: ({ slug, apiKey }: { slug: string; apiKey: string }) =>
      marketplaceService.installPlugin(slug, apiKey),
    onSuccess: async (result) => {
      await invalidate();
      showToast(result.message, 'success');
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (slug: string) => marketplaceService.uninstallPlugin(slug),
    onSuccess: async (result) => {
      await invalidate();
      showToast(result.message, 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to uninstall plugin', 'error');
    },
  });

  return {
    plugins,
    isLoading,
    error,
    installPlugin: installMutation.mutateAsync,
    isInstalling: installMutation.isPending,
    uninstallPlugin: uninstallMutation.mutateAsync,
    isUninstalling: uninstallMutation.isPending,
  };
}
