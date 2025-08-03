import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Input } from '@/components/radix/Input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/radix/Dialog';
import WarningIcon from '@/assets/icons/warning.svg';
import { configService } from '@/features/auth/services/config.service';
import { useToast } from '@/lib/hooks/useToast';
import { CopyButton } from '@/components/CopyButton';

const getCallbackUrl = () => {
  // Use backend API URL for OAuth callback
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7130';
  return `${apiBaseUrl}/api/auth/v1/callback`;
};

// OAuth provider configuration schema
const oauthProviderSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  redirectUri: z.string().optional(),
  enabled: z.boolean(),
  useSharedKeys: z.boolean(),
});

const oauthConfigSchema = z.object({
  google: oauthProviderSchema,
  github: oauthProviderSchema,
});

type OAuthConfig = z.infer<typeof oauthConfigSchema>;

interface OAuthDialogProps {
  provider: {
    id: string;
    name: string;
    setupUrl: string;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function OAuthDialog({ provider, isOpen, onClose, onSuccess }: OAuthDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  const form = useForm<OAuthConfig>({
    resolver: zodResolver(oauthConfigSchema),
    defaultValues: {
      google: {
        clientId: '',
        clientSecret: '',
        redirectUri: getCallbackUrl(),
        enabled: false,
        useSharedKeys: false,
      },
      github: {
        clientId: '',
        clientSecret: '',
        redirectUri: getCallbackUrl(),
        enabled: false,
        useSharedKeys: false,
      },
    },
  });

  const currentProviderKey = provider?.id as 'google' | 'github';
  const useSharedKeys = form.watch(`${currentProviderKey}.useSharedKeys`);
  const clientId = form.watch(`${currentProviderKey}.clientId`);
  const clientSecret = form.watch(`${currentProviderKey}.clientSecret`);

  const loadOAuthConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const config = await configService.getOAuthConfig();
      form.reset(config);
    } catch (error) {
      const errorMessage = 'Failed to load OAuth configuration';
      setError(errorMessage);
      showToast(errorMessage, 'error');
      console.error('Error loading OAuth config:', error);
    } finally {
      setLoading(false);
    }
  }, [form, showToast]);

  // Load OAuth configuration when dialog opens
  useEffect(() => {
    if (isOpen && provider) {
      void loadOAuthConfig();
    }
  }, [isOpen, provider, loadOAuthConfig]);

  const onSubmit = async (data: OAuthConfig) => {
    if (!provider) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Transform data to ensure required fields are present
      const transformedData = {
        ...data,
        [currentProviderKey]: {
          ...data[currentProviderKey],
          clientId: data[currentProviderKey].clientId || '',
          clientSecret: data[currentProviderKey].clientSecret || '',
          redirectUri: data[currentProviderKey].redirectUri || getCallbackUrl(),
        },
      };

      await configService.updateOAuthConfig(transformedData as OAuthConfig);

      // Show success message
      const configType = useSharedKeys ? 'shared keys' : 'custom OAuth credentials';
      showToast(`${provider.name} ${configType} updated successfully!`, 'success');

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }

      // Close dialog
      onClose();
    } catch (error) {
      const errorMessage = `Failed to update ${provider.name} configuration`;
      setError(errorMessage);
      showToast(errorMessage, 'error');
      console.error('Error saving OAuth config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = () => {
    void onSubmit(form.getValues() as OAuthConfig);
  };

  // Determine if the update button should be disabled
  const isUpdateDisabled = () => {
    if (saving) {
      return true;
    }
    if (useSharedKeys) {
      return false;
    }
    return !clientId || !clientSecret;
  };

  return (
    <Dialog open={isOpen && !!provider} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{provider?.name}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="text-sm text-gray-500">Loading OAuth configuration...</div>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
              {/* Shared Keys Toggle */}
              {/* <div className="flex items-center justify-start gap-2">
                <button
                  type="button"
                  onClick={() =>
                    form.setValue(`${currentProviderKey}.useSharedKeys`, !useSharedKeys)
                  }
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    useSharedKeys ? 'bg-zinc-950' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      useSharedKeys ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-gray-900">Shared Keys</span>
              </div> */}

              {useSharedKeys ? (
                /* Shared Keys Enabled */
                <div className="space-y-6">
                  <p className="text-sm text-zinc-500">
                    Shared keys are created by the InsForge team for development. It helps you get
                    started, but will show a InsForge logo and name on the OAuth screen.
                  </p>

                  <div className="flex items-center gap-3">
                    <img src={WarningIcon} alt="Warning" className="h-6 w-6" />
                    <span className="text-sm font-medium text-zinc-950">
                      Shared keys should never be used in production
                    </span>
                  </div>
                </div>
              ) : (
                /* Shared Keys Disabled */
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-blue-600" />
                    <a
                      href={provider?.setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
                    >
                      Create a {provider?.name.split(' ')[0]} OAuth App
                    </a>
                    <span className="text-sm font-normal text-zinc-950">
                      {' '}
                      and set the callback url to:
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <code className="py-1 px-3 bg-blue-100 text-blue-800 font-mono break-all rounded-md text-sm">
                        {getCallbackUrl()}
                      </code>
                      <CopyButton
                        text={getCallbackUrl()}
                        showToast={true}
                        successMessage="Callback URL copied to clipboard!"
                      />
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex flex-col items-start gap-3">
                      <label className="text-sm font-medium text-zinc-950">Client ID</label>
                      <Input
                        type="text"
                        {...form.register(`${currentProviderKey}.clientId`)}
                        placeholder={`Enter ${provider?.name.split(' ')[0]} OAuth App ID`}
                      />
                    </div>

                    <div className="flex flex-col items-start gap-3">
                      <label className="text-sm font-medium text-zinc-950">Client Secret</label>
                      <Input
                        type="password"
                        {...form.register(`${currentProviderKey}.clientSecret`)}
                        placeholder={`Enter ${provider?.name.split(' ')[0]} OAuth App Secret`}
                      />
                    </div>
                  </div>
                </div>
              )}
            </form>

            <DialogFooter>
              <Button
                type="button"
                className="py-2 px-4 text-sm font-medium"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={isUpdateDisabled()}
                className="py-2 px-4 text-sm font-medium"
              >
                {saving ? 'Saving...' : 'Update'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
