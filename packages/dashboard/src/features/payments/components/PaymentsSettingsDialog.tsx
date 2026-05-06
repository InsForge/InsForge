import { useState, type ReactNode } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Webhook } from 'lucide-react';
import {
  Button,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogDescription,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
} from '@insforge/ui';
import type {
  StripeConnection,
  StripeEnvironment,
  StripeKeyConfig,
} from '@insforge/shared-schemas';
import { usePaymentsConfig } from '#features/payments/hooks/usePaymentsConfig';
import { usePaymentsSync } from '#features/payments/hooks/usePaymentsSync';
import { usePaymentsWebhook } from '#features/payments/hooks/usePaymentsWebhook';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];
type PaymentsSettingsTab = 'keys' | 'sync' | 'webhooks';

const KEY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

interface PaymentsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[200px] shrink-0">
        <div className="py-1.5">
          <p className="text-sm leading-5 text-foreground">{label}</p>
        </div>
        {description && (
          <div className="pb-2 pt-1 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function WebhookStatusBadge({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--alpha-8)] bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Not configured
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
      <CheckCircle2 className="h-3 w-3" />
      Configured
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

interface EnvironmentKeySectionProps {
  environment: StripeEnvironment;
  config?: StripeKeyConfig;
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
  inputValue,
  showKey,
  error,
  isBusy,
  onInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: EnvironmentKeySectionProps) {
  const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];
  const environmentLabel = environment === 'test' ? 'Test Mode' : 'Live Mode';
  const hasPendingInput = inputValue.trim().length > 0;

  return (
    <SettingRow
      label={environmentLabel}
      description={
        <>
          Use a Stripe secret key that starts with{' '}
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
              aria-label={showKey ? 'Hide key' : 'Show key'}
              disabled={isBusy}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {(config?.maskedKey || config?.hasKey || hasPendingInput) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {config?.maskedKey ? (
                <span className="truncate font-mono text-xs text-muted-foreground">
                  {config.maskedKey}
                </span>
              ) : config?.hasKey ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3 w-3" />
                  Configured in InsForge secret store
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {config?.hasKey && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onRemove}
                  disabled={isBusy}
                  className="h-7 px-2"
                >
                  Remove
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
                  Save
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </SettingRow>
  );
}

function DialogSectionDivider() {
  return (
    <div className="flex h-5 items-center justify-center">
      <div className="h-px w-full bg-[var(--alpha-8)]" />
    </div>
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
  keyInputs: Record<StripeEnvironment, string>;
  visibleKeys: Record<StripeEnvironment, boolean>;
  errors: Partial<Record<StripeEnvironment, string>>;
  onInputChange: (environment: StripeEnvironment, value: string) => void;
  onToggleShowKey: (environment: StripeEnvironment) => void;
  onSave: (environment: StripeEnvironment) => void;
  onRemove: (environment: StripeEnvironment) => void;
}) {
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Stripe key configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load Stripe key configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Configure the Stripe secret keys to use Payments.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {ENVIRONMENTS.map((environment, index) => (
          <div key={environment} className="flex flex-col gap-2">
            <EnvironmentKeySection
              environment={environment}
              config={keys.find((key) => key.environment === environment)}
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

function SyncTabContent({
  isLoading,
  error,
  configuredKeys,
  syncPayments,
  onSync,
}: {
  isLoading: boolean;
  error: unknown;
  configuredKeys: StripeKeyConfig[];
  syncPayments: ReturnType<typeof usePaymentsSync>['syncPayments'];
  onSync: () => void;
}) {
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Stripe key configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load Stripe key configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Pull the latest products, prices, customers, and subscriptions from Stripe.
        </p>
      </div>

      <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Sync all configured environments</p>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              {configuredKeys.length > 0
                ? `Configured: ${configuredKeys
                    .map((key) => (key.environment === 'test' ? 'Test' : 'Live'))
                    .join(', ')}`
                : 'Configure a Stripe test or live key before syncing.'}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onSync}
            disabled={syncPayments.isPending || configuredKeys.length === 0}
            className="h-9 shrink-0"
          >
            {syncPayments.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Payments
          </Button>
        </div>
      </div>

      {syncPayments.error && (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {syncPayments.error instanceof Error
            ? syncPayments.error.message
            : 'Failed to sync Stripe payments.'}
        </div>
      )}
    </div>
  );
}

function WebhooksTabContent({
  keys,
  connections,
  isLoading,
  isLoadingWebhooks,
  error,
  webhooksError,
  configureWebhook,
  isBusy,
  onConfigure,
}: {
  keys: StripeKeyConfig[];
  connections: StripeConnection[];
  isLoading: boolean;
  isLoadingWebhooks: boolean;
  error: unknown;
  webhooksError: unknown;
  configureWebhook: ReturnType<typeof usePaymentsWebhook>['configureWebhook'];
  isBusy: boolean;
  onConfigure: (environment: StripeEnvironment) => void;
}) {
  if ((isLoading || isLoadingWebhooks) && !error && !webhooksError) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Stripe webhook configuration...
      </div>
    );
  }

  if (error || webhooksError) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load Stripe webhook configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Configure Stripe webhook endpoints for customer, payment history, and subscription
          updates.
        </p>
      </div>

      {ENVIRONMENTS.map((environment) => (
        <WebhookEnvironmentSection
          key={environment}
          environment={environment}
          config={keys.find((key) => key.environment === environment)}
          connection={connections.find((connection) => connection.environment === environment)}
          isConfiguring={configureWebhook.isPending && configureWebhook.variables === environment}
          isBusy={isBusy}
          onConfigure={() => onConfigure(environment)}
        />
      ))}

      {configureWebhook.error && (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {configureWebhook.error instanceof Error
            ? configureWebhook.error.message
            : 'Failed to configure Stripe webhook.'}
        </div>
      )}
    </div>
  );
}

interface WebhookEnvironmentSectionProps {
  environment: StripeEnvironment;
  config?: StripeKeyConfig;
  connection?: StripeConnection;
  isConfiguring: boolean;
  isBusy: boolean;
  onConfigure: () => void;
}

function WebhookEnvironmentSection({
  environment,
  config,
  connection,
  isConfiguring,
  isBusy,
  onConfigure,
}: WebhookEnvironmentSectionProps) {
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';
  const keyName = environment === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';
  const isKeyConfigured = !!config?.hasKey;
  const isWebhookConfigured = !!connection?.webhookEndpointId && !!connection.webhookEndpointUrl;

  return (
    <SettingRow
      label={environmentLabel}
      description={
        isKeyConfigured
          ? 'InsForge creates and stores a Stripe webhook signing secret for this environment.'
          : `Configure ${keyName} before creating the webhook.`
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
                <span className="text-muted-foreground">Endpoint</span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {connection.webhookEndpointUrl}
                </span>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">Stripe ID</span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {connection.webhookEndpointId}
                </span>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">Secret</span>
                <span className="text-foreground">Stored in InsForge secret store</span>
              </div>
            </div>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              {isKeyConfigured
                ? 'No managed Stripe webhook is configured yet. Create one when your backend has a public API URL.'
                : 'Webhook setup uses the saved Stripe API key, so the key must be configured first.'}
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
            {isWebhookConfigured ? 'Reconfigure webhook' : 'Configure webhook'}
          </Button>
        </div>
      </div>
    </SettingRow>
  );
}

export function PaymentsSettingsDialog({ open, onOpenChange }: PaymentsSettingsDialogProps) {
  const { keys, isLoading, error, saveKey, removeKey } = usePaymentsConfig();
  const { syncPayments } = usePaymentsSync();
  const {
    connections,
    isLoading: isLoadingWebhooks,
    error: webhooksError,
    configureWebhook,
  } = usePaymentsWebhook();
  const [activeTab, setActiveTab] = useState<PaymentsSettingsTab>('keys');
  const [keyInputs, setKeyInputs] = useState<Record<StripeEnvironment, string>>({
    test: '',
    live: '',
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<StripeEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<StripeEnvironment, string>>>({});

  const isBusy =
    saveKey.isPending ||
    removeKey.isPending ||
    syncPayments.isPending ||
    configureWebhook.isPending;
  const canClose = !isBusy;
  const configuredKeys = keys.filter((key) => key.hasKey);
  const title = activeTab === 'keys' ? 'Stripe Keys' : activeTab === 'sync' ? 'Sync' : 'Webhooks';

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }

    if (!nextOpen) {
      setKeyInputs({ test: '', live: '' });
      setVisibleKeys({ test: false, live: false });
      setErrors({});
      saveKey.reset();
      removeKey.reset();
      syncPayments.reset();
      configureWebhook.reset();
      setActiveTab('keys');
    }

    onOpenChange(nextOpen);
  };

  const handleSave = async (environment: StripeEnvironment) => {
    const secretKey = keyInputs[environment].trim();
    const expectedPrefix = KEY_PREFIX_BY_ENVIRONMENT[environment];

    if (!secretKey) {
      setErrors((current) => ({ ...current, [environment]: 'Please enter a Stripe secret key.' }));
      return;
    }

    if (!secretKey.startsWith(expectedPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: `The ${environment} key must start with ${expectedPrefix}.`,
      }));
      return;
    }

    setErrors((current) => ({ ...current, [environment]: undefined }));

    try {
      await saveKey.mutateAsync({ environment, secretKey });
      setKeyInputs((current) => ({ ...current, [environment]: '' }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to save Stripe key.',
      }));
    }
  };

  const handleRemove = async (environment: StripeEnvironment) => {
    setErrors((current) => ({ ...current, [environment]: undefined }));

    try {
      await removeKey.mutateAsync(environment);
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to remove Stripe key.',
      }));
    }
  };

  const handleSync = async () => {
    try {
      await syncPayments.mutateAsync({ environment: 'all' });
    } catch {
      // The mutation owns toast/error state.
    }
  };

  const handleConfigureWebhook = async (environment: StripeEnvironment) => {
    try {
      await configureWebhook.mutateAsync(environment);
    } catch {
      // The mutation owns toast/error state.
    }
  };

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>Payments Settings</MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<KeyRound className="h-5 w-5" />}
                active={activeTab === 'keys'}
                onClick={() => setActiveTab('keys')}
              >
                Stripe Keys
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<RefreshCw className="h-5 w-5" />}
                active={activeTab === 'sync'}
                onClick={() => setActiveTab('sync')}
              >
                Sync
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<Webhook className="h-5 w-5" />}
                active={activeTab === 'webhooks'}
                onClick={() => setActiveTab('webhooks')}
              >
                Webhooks
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{title}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">{title} settings</MenuDialogDescription>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          <MenuDialogBody>
            {activeTab === 'keys' ? (
              <StripeKeysTabContent
                keys={keys}
                isLoading={isLoading}
                error={error}
                isBusy={isBusy}
                keyInputs={keyInputs}
                visibleKeys={visibleKeys}
                errors={errors}
                onInputChange={(environment, value) =>
                  setKeyInputs((current) => ({ ...current, [environment]: value }))
                }
                onToggleShowKey={(environment) =>
                  setVisibleKeys((current) => ({
                    ...current,
                    [environment]: !current[environment],
                  }))
                }
                onSave={(environment) => void handleSave(environment)}
                onRemove={(environment) => void handleRemove(environment)}
              />
            ) : activeTab === 'sync' ? (
              <SyncTabContent
                isLoading={isLoading}
                error={error}
                configuredKeys={configuredKeys}
                syncPayments={syncPayments}
                onSync={() => void handleSync()}
              />
            ) : (
              <WebhooksTabContent
                keys={keys}
                connections={connections}
                isLoading={isLoading}
                isLoadingWebhooks={isLoadingWebhooks}
                error={error}
                webhooksError={webhooksError}
                configureWebhook={configureWebhook}
                isBusy={isBusy}
                onConfigure={(environment) => void handleConfigureWebhook(environment)}
              />
            )}
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
