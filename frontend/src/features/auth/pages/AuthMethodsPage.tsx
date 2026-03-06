import { useState, useCallback, useEffect } from 'react';
import { Mail, ChevronRight } from 'lucide-react';
import { PasswordSettingsDialog, OAuthConfigDialog } from '@/features/auth/components';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { useConfirm } from '@/lib/hooks/useConfirm';
import {
  Button,
  ConfirmDialog,
} from '@insforge/ui';
import { oauthProviders, type OAuthProviderInfo } from '@/features/auth/helpers';

interface AuthMethodsPageProps {
  openSettingsOnMount?: boolean;
}

export default function AuthMethodsPage({ openSettingsOnMount = false }: AuthMethodsPageProps) {
  const [selectedProvider, setSelectedProvider] = useState<OAuthProviderInfo>();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const { confirmDialogProps } = useConfirm();
  const {
    isLoadingConfigs,
    refetchConfigs,
    isProviderConfigured,
  } = useOAuthConfig();

  const handleConfigureProvider = (provider: OAuthProviderInfo) => {
    setSelectedProvider(provider);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedProvider(undefined);
  };

  const handleSuccess = useCallback(() => {
    void refetchConfigs();
  }, [refetchConfigs]);

  useEffect(() => {
    if (openSettingsOnMount) {
      setIsPasswordDialogOpen(true);
    }
  }, [openSettingsOnMount]);

  if (isLoadingConfigs) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
        <div className="flex flex-1 items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading OAuth configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <div className="shrink-0 px-6 pb-6 pt-10 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <h1 className="text-2xl font-medium leading-8 text-foreground">Auth Methods</h1>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 sm:px-10">
        <div className="mx-auto w-full max-w-[1024px]">
          <div className="overflow-hidden rounded-xl border border-border bg-card">

            {/* Email — always enabled */}
            <button
              type="button"
              onClick={() => setIsPasswordDialogOpen(true)}
              className="flex min-h-[56px] w-full items-center gap-3 px-6 pr-4 text-left transition-colors hover:bg-alpha-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Mail strokeWidth={1.5} className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium leading-6 text-muted-foreground">
                  Email
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="min-w-[80px] rounded-lg bg-primary/15 px-3 py-1.5 text-center text-xs font-medium text-primary">
                  Enabled
                </span>
                <ChevronRight strokeWidth={1.5} className="h-4 w-4 text-muted-foreground/50" />
              </div>
            </button>

            {/* All OAuth providers */}
            {oauthProviders.map((provider) => {
              const configured = isProviderConfigured(provider.id);

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleConfigureProvider(provider)}
                  className="flex min-h-[56px] w-full items-center gap-3 px-6 pr-4 text-left transition-colors hover:bg-alpha-4"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {provider.icon}
                    <span className="truncate text-sm font-medium leading-6 text-muted-foreground">
                      {provider.name}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {configured ? (
                      <span className="min-w-[80px] rounded-lg bg-primary/15 px-3 py-1.5 text-center text-xs font-medium text-primary">
                        Enabled
                      </span>
                    ) : (
                      <span className="min-w-[80px] rounded-lg border border-border px-3 py-1.5 text-center text-xs font-medium text-muted-foreground">
                        Disabled
                      </span>
                    )}
                    <ChevronRight strokeWidth={1.5} className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <OAuthConfigDialog
        provider={selectedProvider}
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleSuccess}
      />
      <PasswordSettingsDialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      />
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
