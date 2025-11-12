import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/radix/Button';
import { MoreHorizontal, Plus, Trash2, Pencil, Mail, ChevronDown } from 'lucide-react';
import { OAuthConfigDialog } from '@/features/auth/components/OAuthConfigDialog';
import { AuthPreview } from '@/features/auth/components/AuthPreview';
import { CopyButton } from '@/components/CopyButton';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/radix/DropdownMenu';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';
import {
  oauthProviders,
  type OAuthProviderInfo,
  AUTH_IMPLEMENTATION_PROMPT,
} from '@/features/auth/helpers';

export default function AuthMethodsPage() {
  const [selectedProvider, setSelectedProvider] = useState<OAuthProviderInfo>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
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
      deleteConfig(providerId);
    }
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedProvider(undefined);
  };

  const hasAuthMethods = useMemo(() => {
    return !!configs.length;
  }, [configs]);

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

  const handleSuccess = useCallback(() => {
    // Refresh configuration after successful update
    void refetchConfigs();
  }, [refetchConfigs]);

  if (isLoadingConfigs) {
    return (
      <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-sm text-gray-500 dark:text-zinc-400">
              Loading OAuth configuration...
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Two column layout */}
      <div className="h-full flex overflow-hidden">
        {/* Left Section - Auth Methods List */}
        <div className="flex-1 bg-slate-50 dark:bg-[#2d2d2d] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-6 gap-3">
            <h2 className="px-4 text-xl font-semibold text-gray-900 dark:text-white tracking-tight">
              Auth Methods
            </h2>
            {!allProvidersEnabled && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="h-8 px-2 py-0 gap-2 bg-black text-white dark:bg-neutral-600 dark:text-white hover:bg-gray-800 dark:hover:bg-neutral-500 text-sm font-medium rounded">
                    <Plus className="w-5 h-5" />
                    Add Provider
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  {/* Available providers (not enabled) */}
                  {oauthProviders
                    .filter((provider) => !enabledProviders[provider.id])
                    .map((provider) => (
                      <DropdownMenuItem
                        key={provider.id}
                        onClick={() => handleConfigureProvider(provider)}
                        className="py-2 px-3 flex items-center gap-3 cursor-pointer"
                      >
                        {provider.icon}
                        <span className="text-sm">{provider.name}</span>
                      </DropdownMenuItem>
                    ))}

                  {/* Separator if there are both enabled and disabled providers */}
                  {oauthProviders.some((p) => enabledProviders[p.id]) &&
                    oauthProviders.some((p) => !enabledProviders[p.id]) && (
                      <DropdownMenuSeparator />
                    )}

                  {/* Enabled providers (disabled from selection) */}
                  {oauthProviders
                    .filter((provider) => enabledProviders[provider.id])
                    .map((provider) => (
                      <DropdownMenuItem
                        key={provider.id}
                        disabled
                        className="py-2 px-3 flex items-center justify-between gap-3 opacity-50 cursor-not-allowed"
                      >
                        <div className="flex items-center gap-3">
                          {provider.icon}
                          <span className="text-sm">{provider.name}</span>
                        </div>
                        <span className="text-xs px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded border border-emerald-300 dark:border-emerald-700">
                          Enabled
                        </span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Auth Methods List */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              {/* Email Auth Card */}
              <div className="flex items-center justify-between px-6 py-4 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-transparent">
                <div className="flex items-center gap-3">
                  <Mail className="w-6 h-6 text-gray-700 dark:text-white" />
                  <div className="text-sm font-medium text-black dark:text-white">Email Auth</div>
                </div>
              </div>

              {/* OAuth Providers */}
              {hasAuthMethods &&
                oauthProviders.map((provider) => {
                  const providerConfig = getProviderConfig(provider.id);
                  if (!providerConfig) {
                    return null;
                  }

                  return (
                    <div
                      key={provider.id}
                      className="flex items-center justify-between px-6 py-4 bg-white dark:bg-neutral-800 rounded-lg border border-gray-200 dark:border-transparent"
                    >
                      <div className="flex items-center gap-3">
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
                              className="h-7 w-7 p-1 text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-700"
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
          </div>
        </div>

        {/* Right Section - Preview */}
        <div className="w-[688px] bg-slate-50 dark:bg-[#2d2d2d] p-3 flex flex-col overflow-hidden">
          <div className="h-full bg-gray-200 dark:bg-neutral-700 rounded-xl overflow-hidden flex flex-col">
            {/* Preview Header */}
            <div className="flex items-center justify-end px-6 py-3 gap-3">
              <p className="text-sm font-medium text-gray-700 dark:text-white">
                Integrate Authentication to Your Application
              </p>
              <CopyButton
                text={AUTH_IMPLEMENTATION_PROMPT}
                copyText="Copy Prompt"
                variant="primary"
                className="w-34"
              />
            </div>

            {/* Preview Content */}
            <div className="flex-1 overflow-y-auto py-8 flex flex-col items-center justify-center gap-4">
              <AuthPreview />
              <p className="text-xs text-gray-500 dark:text-neutral-400 text-center">
                Preview Mode
              </p>
            </div>
          </div>
        </div>
      </div>

      <OAuthConfigDialog
        provider={selectedProvider}
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleSuccess}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
