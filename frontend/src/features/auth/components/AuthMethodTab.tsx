import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/radix/Button';
import { MoreHorizontal, Plus, Trash2, Pencil } from 'lucide-react';
import { OAuthEmptyState } from './OAuthEmptyState';
import { OAuthConfigDialog } from './OAuthConfigDialog';
import { AddOAuthDialog } from './AddOAuthDialog';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/radix/DropdownMenu';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';
import { oauthProviders, type OAuthProviderInfo } from '@/features/auth/helpers';

export function AuthMethodTab() {
  const [selectedProvider, setSelectedProvider] = useState<OAuthProviderInfo>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSelectDialogOpen, setIsSelectDialogOpen] = useState(false);
  const { confirm, confirmDialogProps } = useConfirm();
  const {
    configs,
    isLoadingConfigs,
    deleteConfig,
    refetchConfigs,
    getProviderConfig,
    isProviderConfigured,
  } = useOAuthConfig();

  const handleConfigureProvider = (provider: OAuthProviderInfo) => {
    setSelectedProvider(provider);
    setIsDialogOpen(true);
  };

  const deleteOAuthConfig = async (providerId: OAuthProvidersSchema, providerName: string) => {
    const shouldDelete = await confirm({
      title: `Delete ${providerName} OAuth`,
      description: `Are you sure you want to delete the ${providerName} configuration? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    });

    if (shouldDelete) {
      try {
        deleteConfig(providerId);
      } catch (error) {
        console.error(`Failed to delete ${providerId} OAuth:`, error);
      }
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedProvider(undefined);
  };

  const hasAuthMethods = useMemo(() => {
    return !!configs.length;
  }, [configs]);

  const openSelectDialog = () => {
    setIsSelectDialogOpen(true);
  };

  const enabledProviders = useMemo(() => {
    const enabled: Record<OAuthProvidersSchema, boolean> = {} as Record<
      OAuthProvidersSchema,
      boolean
    >;
    oauthProviders.forEach((provider) => {
      enabled[provider.id] = isProviderConfigured(provider.id);
    });
    return enabled;
  }, [isProviderConfigured]);

  // Check if all providers are enabled
  const allProvidersEnabled = useMemo(() => {
    return oauthProviders.every((provider) => enabledProviders[provider.id]);
  }, [enabledProviders]);

  const handleConfirmSelected = (selectedId: OAuthProvidersSchema) => {
    // Find the selected provider
    const selectedProvider = oauthProviders.find((p) => p.id === selectedId);
    if (!selectedProvider) {
      return;
    }

    // Close the select dialog and open the method dialog
    setIsSelectDialogOpen(false);
    setSelectedProvider(selectedProvider);
    setIsDialogOpen(true);
  };

  const handleSuccess = useCallback(() => {
    // Refresh configuration after successful update
    void refetchConfigs();
  }, [refetchConfigs]);

  if (isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="text-sm text-gray-500 dark:text-zinc-400">
            Loading OAuth configuration...
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-6 h-full overflow-hidden p-6 w-full max-w-[1080px] mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">Auth Method</h2>
          {!allProvidersEnabled && (
            <Button
              className="h-9 pr-3 pl-2 py-2 gap-2 dark:bg-neutral-700 dark:text-white dark:hover:bg-neutral-600 text-sm font-medium rounded-sm"
              onClick={openSelectDialog}
            >
              <Plus className="w-5 h-5" />
              Add Auth
            </Button>
          )}
        </div>

        <div className="flex-1">
          {hasAuthMethods ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-6">
              {oauthProviders.map((provider) => {
                const providerConfig = getProviderConfig(provider.id);
                if (!providerConfig) {
                  return null;
                }

                return (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between h-15 p-4 bg-white rounded-[8px] border border-gray-200 dark:border-transparent dark:bg-[#333333]"
                  >
                    <div className="flex-1 flex items-center gap-3">
                      {provider.icon}

                      <div className="text-sm font-medium text-black dark:text-white">
                        {provider.name}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {providerConfig.useSharedKey && (
                        <span className="px-2 py-0.5 text-xs font-medium text-neutral-500 dark:text-neutral-400 border border-neutral-500 dark:border-neutral-400 rounded">
                          Shared Keys
                        </span>
                      )}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            className="h-7 w-7 p-1 text-gray-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                            variant="ghost"
                            size="sm"
                          >
                            <MoreHorizontal className="w-5 h-5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 py-1 px-2">
                          <DropdownMenuItem
                            onClick={() => handleConfigureProvider(provider)}
                            className="py-2 px-3 flex items-center gap-3 cursor-pointer"
                          >
                            <Pencil className="w-5 h-5" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void deleteOAuthConfig(provider.id, provider.name)}
                            className="py-2 px-3 flex items-center gap-3 cursor-pointer text-red-600 dark:text-red-400"
                          >
                            <Trash2 className="w-5 h-5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <OAuthEmptyState />
          )}
        </div>
      </div>

      <OAuthConfigDialog
        provider={selectedProvider}
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleSuccess}
      />

      <AddOAuthDialog
        providers={oauthProviders}
        open={isSelectDialogOpen}
        onOpenChange={setIsSelectDialogOpen}
        onConfirm={handleConfirmSelected}
        enabledProviders={enabledProviders}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </>
  );
}
