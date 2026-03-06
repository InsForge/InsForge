import { useEffect } from 'react';
import { useForm, Controller, useFormState } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ExternalLink } from 'lucide-react';
import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
} from '@insforge/ui';
import WarningIcon from '@/assets/icons/warning.svg';
import {
  oAuthConfigSchema,
  OAuthConfigSchema,
  OAuthProvidersSchema,
} from '@insforge/shared-schemas';
import { type OAuthProviderInfo } from '../helpers';
import { useOAuthConfig } from '@/features/auth/hooks/useOAuthConfig';
import { getBackendUrl, isInsForgeCloudProject } from '@/lib/utils/utils';

const getCallbackUrl = (provider?: string) => {
  // Use backend API URL for OAuth callback
  let backendUrl = getBackendUrl();

  // Check if backend URL contains "localhost" and provider is "x"
  if (provider === 'x' && backendUrl.includes('localhost')) {
    backendUrl = backendUrl.replace('://localhost', '://www.localhost');
  }
  return `${backendUrl}/api/auth/oauth/${provider}/callback`;
};

interface OAuthConfigDialogProps {
  provider?: OAuthProviderInfo;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function OAuthConfigDialog({
  provider,
  isOpen,
  onClose,
  onSuccess,
}: OAuthConfigDialogProps) {
  const {
    configs,
    providerConfig,
    createConfig,
    updateConfig,
    isCreating,
    isUpdating,
    setSelectedProvider,
    isLoadingProvider,
  } = useOAuthConfig();

  const form = useForm<OAuthConfigSchema & { clientSecret?: string }>({
    resolver: zodResolver(oAuthConfigSchema.extend({ clientSecret: z.string().optional() })),
    defaultValues: {
      provider: provider?.id || 'google',
      clientId: '',
      clientSecret: '',
      useSharedKey: false,
    },
  });

  const useSharedKey = form.watch('useSharedKey');
  const clientId = form.watch('clientId');
  const clientSecret = form.watch('clientSecret');

  // Our Cloud only support shared keys of these OAuth Providers for now
  const sharedKeyProviders: readonly OAuthProvidersSchema[] = [
    'google',
    'github',
    'discord',
    'linkedin',
    'facebook',
    'apple',
  ] satisfies readonly OAuthProvidersSchema[];
  const isSharedKeysAvailable =
    isInsForgeCloudProject() && provider?.id && sharedKeyProviders.includes(provider.id);

  // Use useFormState hook for better reactivity
  const { isDirty } = useFormState({
    control: form.control,
  });

  // Set selected provider and refetch when dialog opens
  useEffect(() => {
    if (isOpen && provider) {
      setSelectedProvider(provider.id);
    }
  }, [configs, isOpen, provider, setSelectedProvider]);

  // Load OAuth configuration after fetching
  useEffect(() => {
    if (isOpen && provider && !isLoadingProvider) {
      if (providerConfig) {
        form.reset({
          provider: provider.id,
          clientId: providerConfig.clientId || '',
          clientSecret: providerConfig.clientSecret || '',
          useSharedKey: providerConfig.useSharedKey || false,
        });
      } else {
        form.reset({
          provider: provider.id,
          clientId: '',
          clientSecret: '',
          useSharedKey: isSharedKeysAvailable,
        });
      }
    }
  }, [form, isLoadingProvider, isOpen, isSharedKeysAvailable, provider, providerConfig]);

  const handleSubmitData = (data: OAuthConfigSchema & { clientSecret?: string }) => {
    if (!provider) {
      return;
    }

    try {
      if (providerConfig) {
        // Update existing config
        updateConfig({
          provider: provider.id,
          config: data.useSharedKey
            ? { useSharedKey: true }
            : {
                clientId: data.clientId,
                clientSecret: data.clientSecret,
                useSharedKey: false,
              },
        });
      } else {
        // Create new config
        createConfig({
          provider: provider.id,
          clientId: data.useSharedKey ? undefined : data.clientId,
          clientSecret: data.useSharedKey ? undefined : clientSecret,
          useSharedKey: data.useSharedKey,
        });
      }

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }
      // Close dialog
      onClose();
    } catch (error) {
      console.error('Error saving OAuth config:', error);
    }
  };

  const handleSubmit = () => {
    void handleSubmitData(form.getValues());
  };

  const saving = isCreating || isUpdating;

  // Use RHF's built-in validation and dirty state
  const isDisabled = () => {
    if (saving) {
      return true;
    }

    // In update mode, require dirty state
    if (providerConfig && !isDirty) {
      return true;
    }

    // If using shared keys, always allow (no credential validation needed)
    if (useSharedKey) {
      return false;
    }

    // If NOT using shared keys, require both clientId and clientSecret
    return !clientId || !clientSecret;
  };

  return (
    <Dialog open={isOpen && !!provider} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{provider?.name}</DialogTitle>
        </DialogHeader>
        {isLoadingProvider ? (
          <div className="p-6 flex items-center justify-center">
            <div className="text-center">
              <div className="text-sm text-gray-500 dark:text-zinc-400">
                Loading OAuth configuration...
              </div>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col">
              <div className="space-y-6 p-6">
                {/* Shared Keys Toggle */}
                {isSharedKeysAvailable && (
                  <div className="flex items-center gap-2">
                    <Controller
                      name="useSharedKey"
                      control={form.control}
                      render={({ field }) => (
                        <Switch
                          id="shared-keys-toggle"
                          checked={field.value}
                          onCheckedChange={(value) => field.onChange(value)}
                        />
                      )}
                    />
                    <label htmlFor="shared-keys-toggle" className="text-sm font-medium text-foreground cursor-pointer">Shared Keys</label>
                  </div>
                )}

                {useSharedKey ? (
                  /* Shared Keys Enabled */
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Shared keys are created by the InsForge team for development. It helps you get
                      started, but will show a InsForge logo and name on the OAuth screen.
                    </p>
                    <div className="flex items-center gap-2.5">
                      <img src={WarningIcon} alt="Warning" className="h-5 w-5" />
                      <span className="text-sm font-medium text-foreground">
                        Shared keys should never be used in production
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Shared Keys Disabled */
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={provider?.setupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
                      >
                        Create a {provider?.name} OAuth App
                      </a>
                      <span className="text-sm text-muted-foreground">and set the callback URL to:</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-alpha-4 px-3 py-2">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                        {getCallbackUrl(provider?.id)}
                      </code>
                      <CopyButton text={getCallbackUrl(provider?.id)} showText={false} />
                    </div>
                  </div>
                )}
              </div>
              {!useSharedKey && (
                <div className="space-y-4 border-t border-border p-6">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="oauth-client-id" className="text-sm font-medium text-foreground">Client ID</label>
                    <Input
                      id="oauth-client-id"
                      type="text"
                      {...form.register('clientId')}
                      placeholder={`Enter ${provider?.name} Client ID`}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="oauth-client-secret" className="text-sm font-medium text-foreground">Client Secret</label>
                    <Input
                      id="oauth-client-secret"
                      type="password"
                      {...form.register('clientSecret')}
                      placeholder={`Enter ${provider?.name} Client Secret`}
                    />
                  </div>
                </div>
              )}
            </form>

            <DialogFooter>
              <Button
                type="button"
                className="w-30"
                variant="secondary"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isDisabled()} className="w-30">
                {saving
                  ? providerConfig
                    ? 'Updating...'
                    : 'Adding...'
                  : providerConfig
                    ? 'Update'
                    : 'Add Provider'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
