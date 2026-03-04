import { useState, useCallback, useMemo, useEffect } from 'react';
import { MoreHorizontal, Plus, Trash2, Pencil, Mail, ChevronDown, Settings } from 'lucide-react';
import { AuthSettingsMenuDialog, OAuthConfigDialog } from '@/features/auth/components';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { useConfirm } from '@/lib/hooks/useConfirm';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ConfirmDialog,
} from '@insforge/ui';
import type { OAuthProvidersSchema } from '@insforge/shared-schemas';
import { oauthProviders, type OAuthProviderInfo } from '@/features/auth/helpers';

interface AuthMethodsPageProps {
  openSettingsOnMount?: boolean;
}

export default function AuthMethodsPage({ openSettingsOnMount = false }: AuthMethodsPageProps) {
  const [selectedProvider, setSelectedProvider] = useState<OAuthProviderInfo>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const { confirm, confirmDialogProps } = useConfirm();
  const {
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

  const availableProviders = useMemo(() => {
    return oauthProviders.filter((provider) => !enabledProviders[provider.id]);
  }, [enabledProviders]);

  const configuredProviders = useMemo(() => {
    return oauthProviders.flatMap((provider) => {
      const config = getProviderConfig(provider.id);
      return config ? [{ provider, config }] : [];
    });
  }, [getProviderConfig]);

  const handleSuccess = useCallback(() => {
    void refetchConfigs();
  }, [refetchConfigs]);

  useEffect(() => {
    if (openSettingsOnMount) {
      setIsSettingsDialogOpen(true);
    }
  }, [openSettingsOnMount]);

  if (isLoadingConfigs) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading OAuth configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] items-center justify-between gap-3">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Auth Methods</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-9 rounded px-2 text-foreground"
              onClick={() => setIsSettingsDialogOpen(true)}
            >
              <Settings className="h-5 w-5 stroke-[1.7]" />
              <span className="px-1">Settings</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="h-9 rounded px-2 text-foreground"
                  disabled={availableProviders.length === 0}
                >
                  <Plus className="h-5 w-5 stroke-[1.7]" />
                  <span className="px-1">Add Auth</span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-1.5">
                {availableProviders.map((provider) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => handleConfigureProvider(provider)}
                    className="cursor-pointer gap-1 px-1.5 py-1.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {provider.icon}
                      <span className="truncate">{provider.name}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                {availableProviders.length === 0 && (
                  <DropdownMenuItem disabled className="px-3 py-2">
                    All providers are enabled
                  </DropdownMenuItem>
                )}
                {availableProviders.length > 0 && configuredProviders.length > 0 && (
                  <DropdownMenuSeparator className="my-0.5" />
                )}
                {configuredProviders.map(({ provider }) => (
                  <DropdownMenuItem
                    key={provider.id}
                    onSelect={(event) => event.preventDefault()}
                    className="justify-between gap-1 px-1.5 py-1.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 opacity-60">
                      {provider.icon}
                      <span className="truncate">{provider.name}</span>
                    </div>
                    <Badge className="h-5 shrink-0 rounded bg-primary/20 px-1.5 py-0 text-primary">
                      Enabled
                    </Badge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
        <div className="mx-auto flex w-full max-w-[1024px] flex-col gap-1">
          <div className="flex items-center gap-3 rounded border border-[var(--alpha-8)] bg-card py-4 pl-6 pr-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Mail className="h-5 w-5 text-foreground" />
              <span className="truncate text-sm font-medium leading-6 text-foreground">
                Email Password
              </span>
            </div>
          </div>

          {configuredProviders.map(({ provider, config }) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 rounded border border-[var(--alpha-8)] bg-card py-4 pl-6 pr-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {provider.icon}
                <span className="truncate text-sm font-medium leading-6 text-foreground">
                  {provider.name}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {config.useSharedKey && (
                  <Badge className="h-5 rounded bg-[var(--alpha-8)] px-2 py-0 text-xs font-medium leading-4 text-muted-foreground">
                    Shared Keys
                  </Badge>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 rounded p-1 text-muted-foreground hover:bg-[var(--alpha-8)] hover:text-foreground active:bg-[var(--alpha-12)]"
                    >
                      <MoreHorizontal className="h-5 w-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 p-1.5">
                    <DropdownMenuItem
                      onClick={() => handleConfigureProvider(provider)}
                      className="cursor-pointer gap-2"
                    >
                      <Pencil className="h-5 w-5" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void deleteOAuthConfig(provider.id, provider.name)}
                      className="cursor-pointer gap-2 text-destructive"
                    >
                      <Trash2 className="h-5 w-5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </div>

      <OAuthConfigDialog
        provider={selectedProvider}
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleSuccess}
      />
      <AuthSettingsMenuDialog
        open={isSettingsDialogOpen}
        onOpenChange={(open) => setIsSettingsDialogOpen(open)}
      />

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
