import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Webhook,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  CopyButton,
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
  PaymentProvider,
  RazorpayKeyConfig,
  StripeConnection,
  StripeEnvironment,
  StripeKeyConfig,
} from '@insforge/shared-schemas';
import { usePaymentsConfig } from '#features/payments/hooks/usePaymentsConfig';
import { usePaymentsSync } from '#features/payments/hooks/usePaymentsSync';
import { usePaymentsWebhook } from '#features/payments/hooks/usePaymentsWebhook';
import { useRazorpayConfig } from '#features/payments/hooks/useRazorpayConfig';
import { useRazorpaySync } from '#features/payments/hooks/useRazorpaySync';
import {
  useRazorpayWebhook,
  useRazorpayWebhookSetup,
} from '#features/payments/hooks/useRazorpayWebhook';
import { PaymentProviderSelect, PAYMENT_PROVIDER_LABELS } from './PaymentProviderSelect';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];
type PaymentsSettingsTab = 'keys' | 'webhooks' | 'sync';
type PaymentKeyConfig = StripeKeyConfig | RazorpayKeyConfig;
type PaymentConnection = StripeConnection;

const KEY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};

const RAZORPAY_PREFIX_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'rzp_test_',
  live: 'rzp_live_',
};
const RAZORPAY_WEBHOOK_DOCS_URL =
  'https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/';
const RAZORPAY_RECOMMENDED_WEBHOOK_EVENTS = [
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
  'refund.created',
  'refund.processed',
  'refund.failed',
  'subscription.created',
  'subscription.activated',
  'subscription.charged',
  'subscription.updated',
  'subscription.cancelled',
  'subscription.paused',
  'subscription.resumed',
  'subscription.halted',
  'subscription.completed',
  'subscription.expired',
  'invoice.paid',
  'invoice.expired',
];

function getConfiguredRazorpayApiKeys(keys: RazorpayKeyConfig[]): RazorpayKeyConfig[] {
  const environmentsWithSecret = new Set(
    keys.filter((key) => key.keyType === 'api_secret' && key.hasKey).map((key) => key.environment)
  );

  return keys.filter(
    (key) => key.keyType === 'api_key' && key.hasKey && environmentsWithSecret.has(key.environment)
  );
}

interface PaymentsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProvider: PaymentProvider;
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  orientation?: 'horizontal' | 'vertical';
}

function SettingRow({ label, description, children, orientation = 'horizontal' }: SettingRowProps) {
  if (orientation === 'vertical') {
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <div className="w-full shrink-0">
          <div className="py-1 flex items-center">
            <p className="text-sm font-medium leading-5 text-foreground">{label}</p>
          </div>
          {description && (
            <div className="pb-3 text-[13px] leading-[18px] text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        <div className="min-w-0 w-full">{children}</div>
      </div>
    );
  }

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

function isPublicHttpsWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1' &&
      url.hostname !== '::1' &&
      url.hostname !== '[::1]' &&
      !url.hostname.startsWith('127.')
    );
  } catch {
    return false;
  }
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

// RAZORPAY KEYS TAB CONTENT
function RazorpayKeysTabContent({
  keys,
  isLoading,
  error,
  isBusy,
  keyIdInputs,
  keySecretInputs,
  visibleKeys,
  errors,
  onIdInputChange,
  onSecretInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: {
  keys: RazorpayKeyConfig[];
  isLoading: boolean;
  error: unknown;
  isBusy: boolean;
  keyIdInputs: Record<StripeEnvironment, string>;
  keySecretInputs: Record<StripeEnvironment, string>;
  visibleKeys: Record<StripeEnvironment, boolean>;
  errors: Partial<Record<StripeEnvironment, string>>;
  onIdInputChange: (environment: StripeEnvironment, value: string) => void;
  onSecretInputChange: (environment: StripeEnvironment, value: string) => void;
  onToggleShowKey: (environment: StripeEnvironment) => void;
  onSave: (environment: StripeEnvironment) => void;
  onRemove: (environment: StripeEnvironment) => void;
}) {
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Razorpay key configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load Razorpay key configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Configure the Razorpay API Keys to use Payments.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {ENVIRONMENTS.map((environment, index) => {
          const envIdKey = keys.find(
            (key) => key.environment === environment && key.keyType === 'api_key'
          );
          const envSecretKey = keys.find(
            (key) => key.environment === environment && key.keyType === 'api_secret'
          );

          const hasKeys = envIdKey?.hasKey && envSecretKey?.hasKey;
          const expectedPrefix = RAZORPAY_PREFIX_BY_ENVIRONMENT[environment];
          const environmentLabel = environment === 'test' ? 'Test Mode' : 'Live Mode';
          const hasPendingInput =
            keyIdInputs[environment].trim().length > 0 ||
            keySecretInputs[environment].trim().length > 0;
          const keyIdInputId = `razorpay-${environment}-key-id`;
          const keySecretInputId = `razorpay-${environment}-key-secret`;

          return (
            <div key={environment} className="flex flex-col gap-2">
              <SettingRow
                label={environmentLabel}
                description={
                  <>
                    Use a Razorpay Key ID that starts with{' '}
                    <span className="font-mono text-foreground">{expectedPrefix}</span> and its
                    matching Key Secret.
                  </>
                }
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                      <label
                        htmlFor={keyIdInputId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Key ID
                      </label>
                      <input
                        id={keyIdInputId}
                        type="text"
                        value={keyIdInputs[environment]}
                        onChange={(event) => onIdInputChange(environment, event.target.value)}
                        placeholder={`${expectedPrefix}...`}
                        disabled={isBusy}
                        className="h-8 w-full rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))] hover:bg-[var(--alpha-4)] disabled:opacity-50"
                      />
                    </div>
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                      <label
                        htmlFor={keySecretInputId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Key Secret
                      </label>
                      <div className="relative">
                        <input
                          id={keySecretInputId}
                          type={visibleKeys[environment] ? 'text' : 'password'}
                          value={keySecretInputs[environment]}
                          onChange={(event) => onSecretInputChange(environment, event.target.value)}
                          placeholder="Enter key secret"
                          disabled={isBusy}
                          className="h-8 w-full rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 pr-9 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))] hover:bg-[var(--alpha-4)] disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => onToggleShowKey(environment)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          disabled={isBusy}
                        >
                          {visibleKeys[environment] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {errors[environment] && (
                    <p className="text-xs text-destructive">{errors[environment]}</p>
                  )}

                  {(hasKeys || hasPendingInput) && (
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 mt-2">
                      <div /> {/* Empty spacer for the label column */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {envIdKey?.maskedKey ? (
                            <div className="flex flex-col gap-1">
                              <span className="block truncate font-mono text-xs text-muted-foreground">
                                ID: {envIdKey.maskedKey}
                              </span>
                              {envSecretKey?.hasKey && (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                                  Secret: {envSecretKey.maskedKey}
                                </span>
                              )}
                            </div>
                          ) : hasKeys ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <CheckCircle2 className="h-3 w-3 text-green-500" />
                              Configured in secret store
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          {hasKeys && (
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => onRemove(environment)}
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
                              onClick={() => onSave(environment)}
                              disabled={isBusy}
                              className="h-7 px-2"
                            >
                              {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              Save
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </SettingRow>
              {index < ENVIRONMENTS.length - 1 && <DialogSectionDivider />}
            </div>
          );
        })}
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
  provider = 'stripe',
}: {
  isLoading: boolean;
  error: unknown;
  configuredKeys: PaymentKeyConfig[];
  syncPayments:
    | ReturnType<typeof usePaymentsSync>['syncPayments']
    | ReturnType<typeof useRazorpaySync>['syncPayments'];
  onSync: () => void;
  provider?: 'stripe' | 'razorpay';
}) {
  const providerName = provider === 'stripe' ? 'Stripe' : 'Razorpay';
  const syncDescription =
    provider === 'stripe'
      ? 'Force a manual sync of Stripe products, prices, customers, and active subscriptions. Normally, Stripe events sync automatically via webhooks.'
      : 'Force a manual sync of Razorpay items, plans, customers, subscriptions, invoices, and payments. Normally, Razorpay events sync automatically via webhooks.';

  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading {providerName} key configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load {providerName} key configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">{syncDescription}</p>
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
                : `Configure a ${providerName} test or live key before syncing.`}
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
            : `Failed to sync ${providerName} payments.`}
        </div>
      )}
    </div>
  );
}

function StripeWebhooksTabContent({
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
  connections: PaymentConnection[];
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
          Configure Stripe webhook endpoints for customer, transaction, and subscription updates.
        </p>
      </div>

      {ENVIRONMENTS.map((environment) => (
        <StripeWebhookEnvironmentSection
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

interface StripeWebhookEnvironmentSectionProps {
  environment: StripeEnvironment;
  config?: StripeKeyConfig;
  connection?: PaymentConnection;
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
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';
  const keyName = environment === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';

  const isKeyConfigured = !!config?.hasKey;
  const webhookEndpointUrl = connection?.webhookEndpointUrl ?? null;
  const webhookEndpointId = connection?.webhookEndpointId ?? null;
  const isWebhookConfigured = !!webhookEndpointId && !!webhookEndpointUrl;

  return (
    <SettingRow
      orientation="vertical"
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
                  {webhookEndpointUrl}
                </span>
              </div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
                <span className="text-muted-foreground">Stripe ID</span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {webhookEndpointId}
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

function RazorpayWebhooksTabContent({
  keys,
  regenerateWebhookSecret,
  isBusy,
  onGoToKeys,
}: {
  keys: RazorpayKeyConfig[];
  regenerateWebhookSecret: ReturnType<typeof useRazorpayWebhook>['regenerateWebhookSecret'];
  isBusy: boolean;
  onGoToKeys: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Razorpay webhooks must be added manually in the Razorpay Dashboard.
        </p>
      </div>

      {ENVIRONMENTS.map((environment, index) => (
        <div key={environment} className="flex flex-col gap-2">
          <RazorpayWebhookEnvironmentSection
            environment={environment}
            keys={keys}
            regenerateWebhookSecret={regenerateWebhookSecret}
            isBusy={isBusy}
            onGoToKeys={onGoToKeys}
          />
          {index < ENVIRONMENTS.length - 1 && <DialogSectionDivider />}
        </div>
      ))}

      <RazorpayWebhookManualSetupGuidance />
    </div>
  );
}

function RazorpayWebhookManualSetupGuidance() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-[var(--alpha-8)] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Manual setup steps</p>
          <a
            href={RAZORPAY_WEBHOOK_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Razorpay docs
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
          <li>Open Razorpay Dashboard and go to Accounts &amp; Settings → Webhooks.</li>
          <li>Add a webhook for each environment you enable.</li>
          <li>Paste the matching environment&apos;s Webhook URL and Webhook Secret above.</li>
          <li>Select the Active Events listed below.</li>
          <li>Save the webhook, then make a test payment to verify delivery.</li>
        </ol>
      </div>

      <div className="rounded border border-[var(--alpha-8)] p-3">
        <p className="text-sm font-medium text-foreground">Active Events to select</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {RAZORPAY_RECOMMENDED_WEBHOOK_EVENTS.map((event) => (
            <span
              key={event}
              className="rounded border border-[var(--alpha-8)] bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              {event}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RazorpayWebhookEnvironmentSection({
  environment,
  keys,
  regenerateWebhookSecret,
  isBusy,
  onGoToKeys,
}: {
  environment: StripeEnvironment;
  keys: RazorpayKeyConfig[];
  regenerateWebhookSecret: ReturnType<typeof useRazorpayWebhook>['regenerateWebhookSecret'];
  isBusy: boolean;
  onGoToKeys: () => void;
}) {
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';
  const hasKeyId = keys.some(
    (key) => key.environment === environment && key.keyType === 'api_key' && key.hasKey
  );
  const hasKeySecret = keys.some(
    (key) => key.environment === environment && key.keyType === 'api_secret' && key.hasKey
  );
  const isKeyConfigured = hasKeyId && hasKeySecret;
  const setupQuery = useRazorpayWebhookSetup(environment, isKeyConfigured);
  const setup = setupQuery.data ?? null;
  const isWebhookUrlPublic = setup ? isPublicHttpsWebhookUrl(setup.webhookUrl) : true;
  const isRegenerating =
    regenerateWebhookSecret.isPending && regenerateWebhookSecret.variables === environment;

  return (
    <SettingRow
      orientation="vertical"
      label={environmentLabel}
      description={
        isKeyConfigured
          ? 'Copy these values into the Razorpay Dashboard for this environment.'
          : 'Configure Razorpay keys first.'
      }
    >
      {!isKeyConfigured ? (
        <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">Configure Razorpay keys first.</p>
          <Button type="button" size="sm" className="mt-3 h-8" onClick={onGoToKeys}>
            Connection Keys
          </Button>
        </div>
      ) : setupQuery.isLoading ? (
        <div className="flex min-h-[96px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Razorpay webhook setup values...
        </div>
      ) : setupQuery.error || !setup ? (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load Razorpay webhook setup values. Close the dialog and try again.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-3">
            <div className="grid gap-3 text-xs">
              <div className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-muted-foreground">Webhook URL</span>
                <span className="min-w-0 break-all font-mono text-foreground">
                  {setup.webhookUrl}
                </span>
                <CopyButton text={setup.webhookUrl} showText={false} />
              </div>
              {!isWebhookUrlPublic && (
                <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                  Razorpay can only deliver webhooks to a public HTTPS URL.
                </div>
              )}
              <div className="grid grid-cols-[112px_minmax(0,1fr)_auto_auto] items-center gap-3">
                <span className="text-muted-foreground">Webhook Secret</span>
                <span className="min-w-0 break-all font-mono text-foreground">
                  {setup.webhookSecret}
                </span>
                <CopyButton text={setup.webhookSecret} showText={false} />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 px-2"
                  disabled={isBusy}
                  onClick={() => setIsRegenerateConfirmOpen(true)}
                >
                  {isRegenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Regenerate
                </Button>
              </div>
            </div>
          </div>

          <ConfirmDialog
            open={isRegenerateConfirmOpen}
            onOpenChange={setIsRegenerateConfirmOpen}
            title="Regenerate Razorpay webhook secret?"
            description="Regenerating the webhook secret will break existing Razorpay webhook deliveries until you update the secret in Razorpay Dashboard."
            cancelText="Cancel"
            confirmText="Regenerate"
            destructive
            isLoading={isRegenerating}
            onConfirm={async () => {
              await regenerateWebhookSecret.mutateAsync(environment);
            }}
          />
        </div>
      )}
    </SettingRow>
  );
}

export function PaymentsSettingsDialog({
  open,
  onOpenChange,
  initialProvider,
}: PaymentsSettingsDialogProps) {
  const { keys, isLoading, error, saveKey, removeKey } = usePaymentsConfig();
  const { syncPayments } = usePaymentsSync();
  const {
    connections,
    isLoading: isLoadingWebhooks,
    error: webhooksError,
    configureWebhook,
  } = usePaymentsWebhook();

  // Razorpay hooks
  const {
    keys: rzpKeys,
    isLoading: rzpIsLoading,
    error: rzpError,
    saveKey: rzpSaveKey,
    removeKey: rzpRemoveKey,
  } = useRazorpayConfig();
  const { syncPayments: rzpSyncPayments } = useRazorpaySync();
  const { regenerateWebhookSecret } = useRazorpayWebhook();

  const [activeTab, setActiveTab] = useState<PaymentsSettingsTab>('keys');
  const [settingsProvider, setSettingsProvider] = useState<PaymentProvider>(initialProvider);

  // Stripe state
  const [keyInputs, setKeyInputs] = useState<Record<StripeEnvironment, string>>({
    test: '',
    live: '',
  });
  const [visibleKeys, setVisibleKeys] = useState<Record<StripeEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<StripeEnvironment, string>>>({});

  // Razorpay state
  const [rzpKeyIdInputs, setRzpKeyIdInputs] = useState<Record<StripeEnvironment, string>>({
    test: '',
    live: '',
  });
  const [rzpKeySecretInputs, setRzpKeySecretInputs] = useState<Record<StripeEnvironment, string>>({
    test: '',
    live: '',
  });
  const [rzpVisibleKeys, setRzpVisibleKeys] = useState<Record<StripeEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [rzpErrors, setRzpErrors] = useState<Partial<Record<StripeEnvironment, string>>>({});

  const isBusy =
    saveKey.isPending ||
    removeKey.isPending ||
    syncPayments.isPending ||
    configureWebhook.isPending ||
    rzpSaveKey.isPending ||
    rzpRemoveKey.isPending ||
    rzpSyncPayments.isPending ||
    regenerateWebhookSecret.isPending;

  const canClose = !isBusy;
  const configuredKeys = keys.filter((key) => key.hasKey);
  const configuredRzpKeys = getConfiguredRazorpayApiKeys(rzpKeys);
  const title =
    activeTab === 'keys' ? 'Connection Keys' : activeTab === 'webhooks' ? 'Webhooks' : 'Sync';
  const providerName = PAYMENT_PROVIDER_LABELS[settingsProvider];

  useEffect(() => {
    if (open) {
      setSettingsProvider(initialProvider);
    }
  }, [initialProvider, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }

    if (!nextOpen) {
      setKeyInputs({ test: '', live: '' });
      setVisibleKeys({ test: false, live: false });
      setErrors({});
      setRzpKeyIdInputs({ test: '', live: '' });
      setRzpKeySecretInputs({ test: '', live: '' });
      setRzpVisibleKeys({ test: false, live: false });
      setRzpErrors({});

      saveKey.reset();
      removeKey.reset();
      syncPayments.reset();
      configureWebhook.reset();

      rzpSaveKey.reset();
      rzpRemoveKey.reset();
      rzpSyncPayments.reset();
      regenerateWebhookSecret.reset();

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

  const handleRzpSave = (environment: StripeEnvironment) => {
    const keyId = rzpKeyIdInputs[environment].trim();
    const secretKey = rzpKeySecretInputs[environment].trim();
    const expectedPrefix = RAZORPAY_PREFIX_BY_ENVIRONMENT[environment];

    if (!keyId || !secretKey) {
      setRzpErrors((current) => ({
        ...current,
        [environment]: 'Please enter both Key ID and Key Secret.',
      }));
      return;
    }

    if (!keyId.startsWith(expectedPrefix)) {
      setRzpErrors((current) => ({
        ...current,
        [environment]: `Razorpay Key ID must start with ${expectedPrefix}`,
      }));
      return;
    }

    setRzpErrors((current) => ({ ...current, [environment]: undefined }));
    rzpSaveKey.mutate(
      { environment, keyId, keySecret: secretKey },
      {
        onSuccess: () => {
          setRzpKeyIdInputs((current) => ({ ...current, [environment]: '' }));
          setRzpKeySecretInputs((current) => ({ ...current, [environment]: '' }));
        },
      }
    );
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

  const handleRzpRemove = async (environment: StripeEnvironment) => {
    setRzpErrors((current) => ({ ...current, [environment]: undefined }));
    try {
      await rzpRemoveKey.mutateAsync(environment);
    } catch (err) {
      setRzpErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to remove Razorpay keys.',
      }));
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
                Connection Keys
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<Webhook className="h-5 w-5" />}
                active={activeTab === 'webhooks'}
                onClick={() => setActiveTab('webhooks')}
              >
                Webhooks
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<RefreshCw className="h-5 w-5" />}
                active={activeTab === 'sync'}
                onClick={() => setActiveTab('sync')}
              >
                Sync
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{title}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {providerName} {title} settings
            </MenuDialogDescription>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-sm font-medium text-muted-foreground">Provider:</span>
              <PaymentProviderSelect
                value={settingsProvider}
                onValueChange={setSettingsProvider}
                triggerClassName="h-9 w-[132px]"
              />
            </div>
            <MenuDialogCloseButton className="shrink-0" />
          </MenuDialogHeader>

          <MenuDialogBody>
            {activeTab === 'keys' ? (
              settingsProvider === 'stripe' ? (
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
              ) : (
                <RazorpayKeysTabContent
                  keys={rzpKeys}
                  isLoading={rzpIsLoading}
                  error={rzpError}
                  isBusy={isBusy}
                  keyIdInputs={rzpKeyIdInputs}
                  keySecretInputs={rzpKeySecretInputs}
                  visibleKeys={rzpVisibleKeys}
                  errors={rzpErrors}
                  onIdInputChange={(environment, value) =>
                    setRzpKeyIdInputs((current) => ({ ...current, [environment]: value }))
                  }
                  onSecretInputChange={(environment, value) =>
                    setRzpKeySecretInputs((current) => ({ ...current, [environment]: value }))
                  }
                  onToggleShowKey={(environment) =>
                    setRzpVisibleKeys((current) => ({
                      ...current,
                      [environment]: !current[environment],
                    }))
                  }
                  onSave={(environment) => void handleRzpSave(environment)}
                  onRemove={(environment) => void handleRzpRemove(environment)}
                />
              )
            ) : activeTab === 'webhooks' ? (
              settingsProvider === 'stripe' ? (
                <StripeWebhooksTabContent
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
              ) : (
                <RazorpayWebhooksTabContent
                  keys={rzpKeys}
                  regenerateWebhookSecret={regenerateWebhookSecret}
                  isBusy={isBusy}
                  onGoToKeys={() => setActiveTab('keys')}
                />
              )
            ) : settingsProvider === 'stripe' ? (
              <SyncTabContent
                isLoading={isLoading}
                error={error}
                configuredKeys={configuredKeys}
                syncPayments={syncPayments}
                onSync={() => void syncPayments.mutateAsync({ environment: 'all' })}
                provider="stripe"
              />
            ) : (
              <SyncTabContent
                isLoading={rzpIsLoading}
                error={rzpError}
                configuredKeys={configuredRzpKeys}
                syncPayments={rzpSyncPayments}
                onSync={() => void rzpSyncPayments.mutateAsync({ environment: 'all' })}
                provider="razorpay"
              />
            )}
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
