import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Eye, EyeOff, Loader2, Webhook } from 'lucide-react';
import { Button } from '@insforge/ui';
import type {
  PaymentEnvironment,
  StripeConnection,
  StripeKeyConfig,
} from '@insforge/shared-schemas';
import { useStripeConfig } from '#features/payments/hooks/useStripeConfig';
import { useStripeSync } from '#features/payments/hooks/useStripeSync';
import { useStripeWebhook } from '#features/payments/hooks/useStripeWebhook';
import {
  DialogSectionDivider,
  SettingRow,
  type PaymentsSettingsTab,
} from './PaymentsSettingsDialog';
import { ENVIRONMENTS } from '#features/payments/helpers';
import { useEnvironmentValueInputs } from '#features/payments/hooks/useEnvironmentValueInputs';
import { PaymentsSyncTabContent } from './PaymentsSyncTabContent';

const KEY_PREFIX_BY_ENVIRONMENT: Record<PaymentEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

function getStripeKeyValue(keys: StripeKeyConfig[], environment: PaymentEnvironment): string {
  return keys.find((key) => key.environment === environment)?.value ?? '';
}

function getStripeKeyValues(keys: StripeKeyConfig[]): Record<PaymentEnvironment, string> {
  return {
    test: getStripeKeyValue(keys, 'test'),
    live: getStripeKeyValue(keys, 'live'),
  };
}

/**
 * Owns the Stripe-side hooks and form state for the payments settings dialog.
 * The orchestrating dialog combines `isPending` across providers and calls
 * `reset()` on close.
 */
export function useStripeSettings(open: boolean) {
  const { t } = useTranslation('chrome');
  const { keys, isLoading, error, saveKey, removeKey } = useStripeConfig();
  const { syncPayments } = useStripeSync();
  const {
    connections,
    isLoading: isLoadingWebhooks,
    error: webhooksError,
    configureWebhook,
  } = useStripeWebhook();

  const secretKey = useEnvironmentValueInputs();
  const { hydrateFromSaved: hydrateSecretKey } = secretKey;
  const [visibleKeys, setVisibleKeys] = useState<Record<PaymentEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<PaymentEnvironment, string>>>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    hydrateSecretKey(getStripeKeyValues(keys));
  }, [keys, open, hydrateSecretKey]);

  const isPending =
    saveKey.isPending ||
    removeKey.isPending ||
    syncPayments.isPending ||
    configureWebhook.isPending;

  const reset = () => {
    secretKey.reset();
    setVisibleKeys({ test: false, live: false });
    setErrors({});

    saveKey.reset();
    removeKey.reset();
    syncPayments.reset();
    configureWebhook.reset();
  };

  const handleInputChange = (environment: PaymentEnvironment, value: string) => {
    secretKey.setValue(environment, value);
  };

  const handleToggleShowKey = (environment: PaymentEnvironment) => {
    setVisibleKeys((current) => ({ ...current, [environment]: !current[environment] }));
  };

  const handleSave = async (environment: PaymentEnvironment) => {
    const secretKeyValue = secretKey.values[environment].trim();
    const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];

    if (!secretKeyValue) {
      setErrors((current) => ({
        ...current,
        [environment]: t('payments.enterStripeSecretKey', {
          defaultValue: 'Please enter a Stripe secret key.',
        }),
      }));
      return;
    }

    if (!secretKeyValue.startsWith(expectedPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: t('payments.stripeKeyPrefixError', {
          defaultValue: 'The {{environment}} key must start with {{prefix}}.',
          environment,
          prefix: expectedPrefix,
        }),
      }));
      return;
    }

    setErrors((current) => ({ ...current, [environment]: undefined }));

    try {
      await saveKey.mutateAsync({ environment, secretKey: secretKeyValue });
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]:
          err instanceof Error
            ? err.message
            : t('payments.saveStripeKeyFailed', { defaultValue: 'Failed to save Stripe key' }),
      }));
    }
  };

  const handleRemove = async (environment: PaymentEnvironment) => {
    setErrors((current) => ({ ...current, [environment]: undefined }));
    try {
      await removeKey.mutateAsync(environment);
      secretKey.clear(environment);
      setVisibleKeys((current) => ({ ...current, [environment]: false }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]:
          err instanceof Error
            ? err.message
            : t('payments.removeStripeKeyFailed', { defaultValue: 'Failed to remove Stripe key' }),
      }));
    }
  };

  const handleConfigureWebhook = async (environment: PaymentEnvironment) => {
    try {
      await configureWebhook.mutateAsync(environment);
    } catch {
      // The mutation owns toast/error state.
    }
  };

  return {
    keys,
    isLoading,
    error,
    connections,
    isLoadingWebhooks,
    webhooksError,
    syncPayments,
    configureWebhook,
    keyInputs: secretKey.values,
    visibleKeys,
    errors,
    configuredKeys: keys.filter((key) => Boolean(key.value)),
    isPending,
    reset,
    handleInputChange,
    handleToggleShowKey,
    handleSave,
    handleRemove,
    handleConfigureWebhook,
  };
}

export type StripeSettingsState = ReturnType<typeof useStripeSettings>;

export function StripeSettingsPanel({
  activeTab,
  state,
  isBusy,
}: {
  activeTab: PaymentsSettingsTab;
  state: StripeSettingsState;
  isBusy: boolean;
}) {
  if (activeTab === 'keys') {
    return (
      <StripeKeysTabContent
        keys={state.keys}
        isLoading={state.isLoading}
        error={state.error}
        isBusy={isBusy}
        keyInputs={state.keyInputs}
        visibleKeys={state.visibleKeys}
        errors={state.errors}
        onInputChange={state.handleInputChange}
        onToggleShowKey={state.handleToggleShowKey}
        onSave={(environment) => void state.handleSave(environment)}
        onRemove={(environment) => void state.handleRemove(environment)}
      />
    );
  }

  if (activeTab === 'webhooks') {
    return (
      <StripeWebhooksTabContent
        keys={state.keys}
        connections={state.connections}
        isLoading={state.isLoading}
        isLoadingWebhooks={state.isLoadingWebhooks}
        error={state.error}
        webhooksError={state.webhooksError}
        isConfiguringEnvironment={
          state.configureWebhook.isPending ? state.configureWebhook.variables : undefined
        }
        configureWebhookError={state.configureWebhook.error}
        isBusy={isBusy}
        onConfigure={(environment) => void state.handleConfigureWebhook(environment)}
      />
    );
  }

  return (
    <PaymentsSyncTabContent
      isLoading={state.isLoading}
      error={state.error}
      configuredKeys={state.configuredKeys}
      isSyncing={state.syncPayments.isPending}
      syncError={state.syncPayments.error}
      onSync={() => void state.syncPayments.mutateAsync({ environment: 'all' })}
      provider="stripe"
    />
  );
}

interface EnvironmentKeySectionProps {
  environment: PaymentEnvironment;
  config?: StripeKeyConfig;
  savedValue: string;
  inputValue: string;
  showKey: boolean;
  error?: string;
  isBusy: boolean;
  onInputChange: (value: string) => void;
  onToggleShowKey: () => void;
  onSave: () => void;
  onRemove: () => void;
}

function EnvironmentKeySection({
  environment,
  config,
  savedValue,
  inputValue,
  showKey,
  error,
  isBusy,
  onInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: EnvironmentKeySectionProps) {
  const { t } = useTranslation('chrome');
  const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];
  const environmentLabel =
    environment === 'test'
      ? t('payments.testMode', { defaultValue: 'Test Mode' })
      : t('payments.liveMode', { defaultValue: 'Live Mode' });
  const hasSavedValue = Boolean(config?.value);
  const hasPendingInput = inputValue.trim() !== savedValue.trim();

  return (
    <SettingRow
      label={environmentLabel}
      description={
        <>
          {t('payments.stripeKeyHintBefore', {
            defaultValue: 'Use a Stripe secret key that starts with',
          })}{' '}
          <span className="font-mono text-foreground">{expectedPrefix}</span>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="relative min-w-0">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              placeholder={expectedPrefix}
              disabled={isBusy}
              className="h-8 w-full rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 pr-9 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))] hover:bg-[var(--alpha-4)] disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onToggleShowKey}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={
                showKey
                  ? t('payments.hideKey', { defaultValue: 'Hide key' })
                  : t('payments.showKey', { defaultValue: 'Show key' })
              }
              disabled={isBusy}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {(hasSavedValue || hasPendingInput) && (
          <div className="flex flex-wrap justify-end gap-2">
            <div className="flex items-center gap-2">
              {hasSavedValue && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onRemove}
                  disabled={isBusy}
                  className="h-7 px-2"
                >
                  {t('payments.remove', { defaultValue: 'Remove' })}
                </Button>
              )}

              {hasPendingInput && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={onSave}
                  disabled={isBusy}
                  className="h-7 px-2"
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t('payments.save', { defaultValue: 'Save' })}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingRow>
  );
}

function StripeKeysTabContent({
  keys,
  isLoading,
  error,
  isBusy,
  keyInputs,
  visibleKeys,
  errors,
  onInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: {
  keys: StripeKeyConfig[];
  isLoading: boolean;
  error: unknown;
  isBusy: boolean;
  keyInputs: Record<PaymentEnvironment, string>;
  visibleKeys: Record<PaymentEnvironment, boolean>;
  errors: Partial<Record<PaymentEnvironment, string>>;
  onInputChange: (environment: PaymentEnvironment, value: string) => void;
  onToggleShowKey: (environment: PaymentEnvironment) => void;
  onSave: (environment: PaymentEnvironment) => void;
  onRemove: (environment: PaymentEnvironment) => void;
}) {
  const { t } = useTranslation('chrome');
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('payments.loadingKeyConfiguration', {
          defaultValue: 'Loading {{provider}} key configuration...',
          provider: 'Stripe',
        })}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {t('payments.loadKeyConfigurationFailed', {
          defaultValue:
            'Failed to load {{provider}} key configuration. Close the dialog and try again.',
          provider: 'Stripe',
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('payments.stripeKeysIntro', {
            defaultValue: 'Configure the Stripe secret keys to use Payments.',
          })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {ENVIRONMENTS.map((environment, index) => (
          <div key={environment} className="flex flex-col gap-2">
            <EnvironmentKeySection
              environment={environment}
              config={keys.find((key) => key.environment === environment)}
              savedValue={getStripeKeyValue(keys, environment)}
              inputValue={keyInputs[environment]}
              showKey={visibleKeys[environment]}
              error={errors[environment]}
              isBusy={isBusy}
              onInputChange={(value) => onInputChange(environment, value)}
              onToggleShowKey={() => onToggleShowKey(environment)}
              onSave={() => onSave(environment)}
              onRemove={() => onRemove(environment)}
            />
            {index < ENVIRONMENTS.length - 1 && <DialogSectionDivider />}
          </div>
        ))}
      </div>
    </div>
  );
}

function WebhookStatusBadge({ configured }: { configured: boolean }) {
  const { t } = useTranslation('chrome');
  if (!configured) {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--alpha-8)] bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {t('payments.notConfigured', { defaultValue: 'Not configured' })}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3 w-3" />
      {t('payments.configured', { defaultValue: 'Configured' })}
    </span>
  );
}

function formatWebhookConfiguredAt(value: string | null | undefined) {
  if (!value) {
    return 'Not configured';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function StripeWebhooksTabContent({
  keys,
  connections,
  isLoading,
  isLoadingWebhooks,
  error,
  webhooksError,
  isConfiguringEnvironment,
  configureWebhookError,
  isBusy,
  onConfigure,
}: {
  keys: StripeKeyConfig[];
  connections: StripeConnection[];
  isLoading: boolean;
  isLoadingWebhooks: boolean;
  error: unknown;
  webhooksError: unknown;
  isConfiguringEnvironment?: PaymentEnvironment;
  configureWebhookError: unknown;
  isBusy: boolean;
  onConfigure: (environment: PaymentEnvironment) => void;
}) {
  const { t } = useTranslation('chrome');
  if ((isLoading || isLoadingWebhooks) && !error && !webhooksError) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('payments.loadingWebhookConfiguration', {
          defaultValue: 'Loading {{provider}} webhook configuration...',
          provider: 'Stripe',
        })}
      </div>
    );
  }

  if (error || webhooksError) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        {t('payments.loadWebhookConfigurationFailed', {
          defaultValue:
            'Failed to load {{provider}} webhook configuration. Close the dialog and try again.',
          provider: 'Stripe',
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t('payments.stripeWebhooksIntro', {
            defaultValue:
              'Configure Stripe webhook endpoints for customer, transaction, and subscription updates.',
          })}
        </p>
      </div>

      {ENVIRONMENTS.map((environment) => (
        <StripeWebhookEnvironmentSection
          key={environment}
          environment={environment}
          config={keys.find((key) => key.environment === environment)}
          connection={connections.find((connection) => connection.environment === environment)}
          isConfiguring={isConfiguringEnvironment === environment}
          isBusy={isBusy}
          onConfigure={() => onConfigure(environment)}
        />
      ))}

      {Boolean(configureWebhookError) && (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {configureWebhookError instanceof Error
            ? configureWebhookError.message
            : t('payments.configureStripeWebhookFailed', {
                defaultValue: 'Failed to configure Stripe webhook',
              })}
        </div>
      )}
    </div>
  );
}

interface StripeWebhookEnvironmentSectionProps {
  environment: PaymentEnvironment;
  config?: StripeKeyConfig;
  connection?: StripeConnection;
  isConfiguring: boolean;
  isBusy: boolean;
  onConfigure: () => void;
}

function StripeWebhookEnvironmentSection({
  environment,
  config,
  connection,
  isConfiguring,
  isBusy,
  onConfigure,
}: StripeWebhookEnvironmentSectionProps) {
  const { t } = useTranslation('chrome');
  const environmentLabel =
    environment === 'test'
      ? t('payments.testMode', { defaultValue: 'Test Mode' })
      : t('payments.liveMode', { defaultValue: 'Live Mode' });
  const keyName = environment === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';

  const isKeyConfigured = !!config?.value;
  const webhookEndpointUrl = connection?.webhookEndpointUrl ?? null;
  const webhookEndpointId = connection?.webhookEndpointId ?? null;
  const isWebhookConfigured = !!webhookEndpointId && !!webhookEndpointUrl;

  return (
    <SettingRow
      orientation="vertical"
      label={environmentLabel}
      description={
        isKeyConfigured
          ? t('payments.stripeWebhookManagedDescription', {
              defaultValue:
                'InsForge creates and stores a Stripe webhook signing secret for this environment.',
            })
          : t('payments.configureKeyBeforeWebhook', {
              defaultValue: 'Configure {{keyName}} before creating the webhook.',
              keyName,
            })
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <WebhookStatusBadge configured={isWebhookConfigured} />
          {connection?.webhookConfiguredAt && (
            <span className="text-xs text-muted-foreground">
              {formatWebhookConfiguredAt(connection.webhookConfiguredAt)}
            </span>
          )}
        </div>

        <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-3">
          {isWebhookConfigured ? (
            <div className="grid gap-2 text-xs">
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">
                  {t('payments.endpoint', { defaultValue: 'Endpoint' })}
                </span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {webhookEndpointUrl}
                </span>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">
                  {t('payments.stripeId', { defaultValue: 'Stripe ID' })}
                </span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {webhookEndpointId}
                </span>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">
                  {t('payments.secret', { defaultValue: 'Secret' })}
                </span>
                <span className="text-foreground">
                  {t('payments.storedInSecretStore', {
                    defaultValue: 'Stored in InsForge secret store',
                  })}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {isKeyConfigured
                ? t('payments.noManagedWebhook', {
                    defaultValue:
                      'No managed Stripe webhook is configured yet. Create one when your backend has a public API URL.',
                  })
                : t('payments.webhookNeedsKey', {
                    defaultValue:
                      'Webhook setup uses the saved Stripe API key, so the key must be configured first.',
                  })}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            size="lg"
            onClick={onConfigure}
            disabled={!isKeyConfigured || isBusy}
            className="h-9 shrink-0"
          >
            {isConfiguring ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Webhook className="h-4 w-4" />
            )}
            {isWebhookConfigured
              ? t('payments.reconfigureWebhook', { defaultValue: 'Reconfigure webhook' })
              : t('payments.configureWebhook', { defaultValue: 'Configure webhook' })}
          </Button>
        </div>
      </div>
    </SettingRow>
  );
}
