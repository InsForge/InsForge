import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';
import {
  oAuthProvidersSchema,
  type CreateCustomOAuthConfigRequest,
  type CustomOAuthConfigSchema,
  type UpdateCustomOAuthConfigRequest,
} from '@insforge/shared-schemas';
import { SecretInput } from './SecretInput';
import { useCustomOAuthConfig } from '#features/auth/hooks/useCustomOAuthConfig';
import { getBackendUrl } from '#lib/utils/utils';

interface CustomOAuthConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedConfig?: CustomOAuthConfigSchema;
  onSuccess?: () => void;
}

interface FormValues {
  name: string;
  key: string;
  discoveryEndpoint: string;
  clientId: string;
  clientSecret: string;
}

const keyRegex = /^[a-z0-9_-]+$/;
const reservedBuiltInProviderSlugs = new Set<string>(oAuthProvidersSchema.options);

const isValidUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const getCustomCallbackUrl = (providerKey?: string) => {
  const normalizedKey = providerKey?.trim().toLowerCase();
  const callbackKey = normalizedKey || '<provider-key>';
  return `${getBackendUrl()}/api/auth/oauth/custom/${callbackKey}/callback`;
};

export function CustomOAuthConfigDialog({
  isOpen,
  onClose,
  selectedConfig,
  onSuccess,
}: CustomOAuthConfigDialogProps) {
  const { t } = useTranslation('chrome');
  const {
    configs,
    createConfig,
    updateConfig,
    isCreating,
    isUpdating,
    selectedConfig: fetchedConfig,
    isLoadingSelectedConfig,
  } = useCustomOAuthConfig(selectedConfig?.key);

  const form = useForm<FormValues>({
    defaultValues: {
      name: '',
      key: '',
      discoveryEndpoint: '',
      clientId: '',
      clientSecret: '',
    },
  });

  const isEditing = Boolean(selectedConfig);
  const isPending = isCreating || isUpdating;
  const values = form.watch();
  const normalizedProviderKey = values.key.trim().toLowerCase();
  const activeConfig = fetchedConfig ?? selectedConfig;
  const [isClientSecretVisible, setIsClientSecretVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsClientSecretVisible(false);
    }
  }, [isOpen, selectedConfig?.key]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (selectedConfig && isLoadingSelectedConfig) {
      return;
    }

    if (activeConfig) {
      form.reset({
        name: activeConfig.name,
        key: activeConfig.key,
        discoveryEndpoint: activeConfig.discoveryEndpoint,
        clientId: activeConfig.clientId,
        clientSecret: fetchedConfig?.clientSecret || '',
      });
      return;
    }

    form.reset({
      name: '',
      key: '',
      discoveryEndpoint: '',
      clientId: '',
      clientSecret: '',
    });
  }, [
    activeConfig,
    fetchedConfig?.clientSecret,
    form,
    isLoadingSelectedConfig,
    isOpen,
    selectedConfig,
  ]);

  const isSaveDisabled = useMemo(() => {
    if (!values.name.trim() || !values.key.trim() || !values.clientId.trim()) {
      return true;
    }
    if (!isEditing && !values.clientSecret.trim()) {
      return true;
    }
    return !values.discoveryEndpoint.trim();
  }, [isEditing, values]);

  const onSubmit = (data: FormValues) => {
    form.clearErrors();

    const normalizedKey = data.key.trim().toLowerCase();
    if (!keyRegex.test(normalizedKey)) {
      form.setError('key', {
        message: t('auth.keyFormatError', {
          defaultValue: 'Use lowercase letters, numbers, hyphens, and underscores',
        }),
      });
      return;
    }

    if (reservedBuiltInProviderSlugs.has(normalizedKey)) {
      form.setError('key', {
        message: t('auth.keyReservedError', {
          defaultValue: 'This key is reserved by a built-in provider',
        }),
      });
      return;
    }

    const duplicateKey = configs.some(
      (item) => item.key.toLowerCase() === normalizedKey && item.key !== selectedConfig?.key
    );
    if (duplicateKey) {
      form.setError('key', {
        message: t('auth.keyDuplicateError', {
          defaultValue: 'A custom provider with this key already exists',
        }),
      });
      return;
    }

    if (!isValidUrl(data.discoveryEndpoint.trim())) {
      form.setError('discoveryEndpoint', {
        message: t('auth.discoveryEndpointInvalid', {
          defaultValue: 'Discovery endpoint must be a valid URL',
        }),
      });
      return;
    }

    if (isEditing && selectedConfig) {
      const trimmedClientSecret = data.clientSecret.trim();
      const updatePayload: UpdateCustomOAuthConfigRequest = {
        name: data.name.trim(),
        discoveryEndpoint: data.discoveryEndpoint.trim(),
        clientId: data.clientId.trim(),
      };
      if (trimmedClientSecret) {
        updatePayload.clientSecret = trimmedClientSecret;
      }

      updateConfig(
        { key: selectedConfig.key, config: updatePayload },
        {
          onSuccess: () => {
            onSuccess?.();
            onClose();
          },
        }
      );
    } else {
      const createPayload: CreateCustomOAuthConfigRequest = {
        name: data.name.trim(),
        key: normalizedKey,
        discoveryEndpoint: data.discoveryEndpoint.trim(),
        clientId: data.clientId.trim(),
        clientSecret: data.clientSecret.trim(),
      };

      if (!createPayload.clientSecret) {
        form.setError('clientSecret', {
          message: t('auth.clientSecretRequired', { defaultValue: 'Client secret is required' }),
        });
        return;
      }
      createConfig(createPayload, {
        onSuccess: () => {
          onSuccess?.();
          onClose();
        },
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(96vw,820px)] overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--alpha-8)] px-6 py-5">
          <DialogTitle>
            {isEditing
              ? t('auth.editCustomOAuthProvider', { defaultValue: 'Edit Custom OAuth Provider' })
              : t('auth.addCustomOAuthProvider', { defaultValue: 'Add Custom OAuth Provider' })}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('auth.customOAuthDescription', {
              defaultValue: 'Configure a custom OIDC provider using its discovery endpoint.',
            })}
          </p>
        </DialogHeader>

        {isEditing && isLoadingSelectedConfig ? (
          <div className="flex items-center justify-center p-6">
            <div className="text-sm text-muted-foreground">
              {t('auth.loadingCustomOAuthConfig', {
                defaultValue: 'Loading custom OAuth configuration...',
              })}
            </div>
          </div>
        ) : (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void form.handleSubmit(onSubmit)();
              }}
              className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('auth.providerName', { defaultValue: 'Provider Name' })}
                </label>
                <Input
                  placeholder={t('auth.providerNamePlaceholder', { defaultValue: 'e.g. Acme' })}
                  {...form.register('name')}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('auth.providerKey', { defaultValue: 'Provider Key' })}
                </label>
                <Input placeholder="acme_provider" disabled={isEditing} {...form.register('key')} />
                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                  <p>
                    {t('auth.providerKeyHelp', {
                      defaultValue:
                        'Use lowercase letters, numbers, hyphens, and underscores. Add this callback URL to your provider:',
                    })}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 rounded bg-[var(--alpha-8)] px-1.5 py-0.5 font-mono text-[12px] text-foreground break-all">
                      {getCustomCallbackUrl(values.key)}
                    </code>
                    {normalizedProviderKey && (
                      <CopyButton
                        text={getCustomCallbackUrl(values.key)}
                        showText={false}
                        className="shrink-0"
                      />
                    )}
                  </div>
                </div>
                {form.formState.errors.key?.message && (
                  <p className="mt-1 text-xs text-destructive">
                    {form.formState.errors.key.message}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('auth.discoveryEndpoint', { defaultValue: 'Discovery endpoint' })}
                </label>
                <Input
                  placeholder="https://example.com/.well-known/openid-configuration"
                  {...form.register('discoveryEndpoint')}
                />
                {form.formState.errors.discoveryEndpoint?.message && (
                  <p className="mt-1 text-xs text-destructive">
                    {form.formState.errors.discoveryEndpoint.message}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('auth.clientId', { defaultValue: 'Client ID' })}
                </label>
                <Input {...form.register('clientId')} />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('auth.clientSecret', { defaultValue: 'Client Secret' })}
                </label>
                <SecretInput
                  {...form.register('clientSecret')}
                  value={values.clientSecret}
                  isVisible={isClientSecretVisible}
                  onToggleVisibility={() => setIsClientSecretVisible((visible) => !visible)}
                  placeholder={t('auth.enterClientSecret', {
                    defaultValue: 'Enter client secret',
                  })}
                />
                {form.formState.errors.clientSecret?.message && (
                  <p className="mt-1 text-xs text-destructive">
                    {form.formState.errors.clientSecret.message}
                  </p>
                )}
              </div>
            </form>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('auth.cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="button"
                onClick={() => void form.handleSubmit(onSubmit)()}
                disabled={isSaveDisabled || isPending}
              >
                {isEditing
                  ? t('auth.saveChanges', { defaultValue: 'Save Changes' })
                  : t('auth.createProvider', { defaultValue: 'Create provider' })}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
