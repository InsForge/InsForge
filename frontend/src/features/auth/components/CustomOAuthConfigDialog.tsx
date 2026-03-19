import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Button,
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
import { useCustomOAuthConfig } from '@/features/auth/hooks/useCustomOAuthConfig';

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

export function CustomOAuthConfigDialog({
  isOpen,
  onClose,
  selectedConfig,
  onSuccess,
}: CustomOAuthConfigDialogProps) {
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
  const activeConfig = fetchedConfig ?? selectedConfig;
  const [isClientSecretVisible, setIsClientSecretVisible] = useState(false);

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
  }, [activeConfig, fetchedConfig?.clientSecret, form, isLoadingSelectedConfig, isOpen, selectedConfig]);

  const isSaveDisabled = useMemo(() => {
    if (!values.name.trim() || !values.key.trim() || !values.clientId.trim()) {
      return true;
    }
    if (!values.clientSecret.trim()) {
      return true;
    }
    return !values.discoveryEndpoint.trim();
  }, [values]);

  const onSubmit = (data: FormValues) => {
    form.clearErrors();

    const normalizedKey = data.key.trim().toLowerCase();
    if (!keyRegex.test(normalizedKey)) {
      form.setError('key', {
        message: 'Use lowercase letters, numbers, hyphens, and underscores',
      });
      return;
    }

    if (reservedBuiltInProviderSlugs.has(normalizedKey)) {
      form.setError('key', { message: 'This key is reserved by a built-in provider' });
      return;
    }

    const duplicateKey = configs.some(
      (item) => item.key.toLowerCase() === normalizedKey && item.key !== selectedConfig?.key
    );
    if (duplicateKey) {
      form.setError('key', { message: 'A custom provider with this key already exists' });
      return;
    }

    if (!isValidUrl(data.discoveryEndpoint.trim())) {
      form.setError('discoveryEndpoint', { message: 'Discovery endpoint must be a valid URL' });
      return;
    }

    if (isEditing && selectedConfig) {
      const updatePayload: UpdateCustomOAuthConfigRequest = {
        name: data.name.trim(),
        discoveryEndpoint: data.discoveryEndpoint.trim(),
        clientId: data.clientId.trim(),
        clientSecret: data.clientSecret.trim(),
      };

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
        form.setError('clientSecret', { message: 'Client secret is required' });
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
            {isEditing ? 'Edit Custom OAuth Provider' : 'Add Custom OAuth Provider'}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Configure a custom OIDC provider using its discovery endpoint.
          </p>
        </DialogHeader>

        {isEditing && isLoadingSelectedConfig ? (
          <div className="flex items-center justify-center p-6">
            <div className="text-sm text-muted-foreground">
              Loading custom OAuth configuration...
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit(onSubmit)();
            }}
            className="max-h-[72vh] space-y-5 overflow-y-auto px-6 py-5"
          >
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Name</label>
              <Input placeholder="e.g. Acme" {...form.register('name')} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Key</label>
              <Input placeholder="acme_provider" disabled={isEditing} {...form.register('key')} />
              {form.formState.errors.key?.message && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.key.message}</p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Discovery endpoint
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
              <label className="mb-1.5 block text-sm font-medium text-foreground">Client ID</label>
              <Input {...form.register('clientId')} />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Client secret
              </label>
              <SecretInput
                {...form.register('clientSecret')}
                value={values.clientSecret}
                isVisible={isClientSecretVisible}
                onToggleVisibility={() => setIsClientSecretVisible((visible) => !visible)}
                placeholder="Enter client secret"
              />
              {form.formState.errors.clientSecret?.message && (
                <p className="mt-1 text-xs text-destructive">
                  {form.formState.errors.clientSecret.message}
                </p>
              )}
            </div>

            <DialogFooter className="border-t border-[var(--alpha-8)] pt-4">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaveDisabled || isPending}>
                {isEditing ? 'Save changes' : 'Create provider'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
