import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button, ConfirmDialog, CopyButton } from '@insforge/ui';
import type { PaymentEnvironment, RazorpayKeyConfig } from '@insforge/shared-schemas';
import { useRazorpayConfig } from '#features/payments/hooks/useRazorpayConfig';
import { useRazorpaySync } from '#features/payments/hooks/useRazorpaySync';
import {
  useRazorpayWebhook,
  useRazorpayWebhookSetup,
} from '#features/payments/hooks/useRazorpayWebhook';
import {
  DialogSectionDivider,
  ENVIRONMENTS,
  SettingRow,
  SyncTabContent,
  createEmptyEnvironmentValues,
  hydrateEnvironmentValues,
  type PaymentsSettingsTab,
} from './PaymentsSettingsShared';

const RAZORPAY_PREFIX_BY_ENVIRONMENT: Record<PaymentEnvironment, string> = {
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
    keys
      .filter((key) => key.keyType === 'api_secret' && Boolean(key.value))
      .map((key) => key.environment)
  );

  return keys.filter(
    (key) =>
      key.keyType === 'api_key' && Boolean(key.value) && environmentsWithSecret.has(key.environment)
  );
}

function getRazorpayKeyValue(
  keys: RazorpayKeyConfig[],
  environment: PaymentEnvironment,
  keyType: RazorpayKeyConfig['keyType']
): string {
  return (
    keys.find((key) => key.environment === environment && key.keyType === keyType)?.value ?? ''
  );
}

function getRazorpayKeyValues(
  keys: RazorpayKeyConfig[],
  keyType: RazorpayKeyConfig['keyType']
): Record<PaymentEnvironment, string> {
  return {
    test: getRazorpayKeyValue(keys, 'test', keyType),
    live: getRazorpayKeyValue(keys, 'live', keyType),
  };
}

// Hosts that Razorpay's servers can't reach, so a webhook pointed at them would
// silently never fire. Covers loopback plus the RFC 1918 private and
// RFC 3927 link-local IPv4 ranges.
const PRIVATE_OR_LOOPBACK_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
];

function isPublicHttpsWebhookUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isLocalhost = host === 'localhost' || host.endsWith('.localhost');
    const isIpv6Loopback = host === '::1' || host === '[::1]';
    const isPrivateIpv4 = PRIVATE_OR_LOOPBACK_IPV4_PATTERNS.some((pattern) => pattern.test(host));

    return url.protocol === 'https:' && !isLocalhost && !isIpv6Loopback && !isPrivateIpv4;
  } catch {
    return false;
  }
}

/**
 * Owns the Razorpay-side hooks and form state for the payments settings
 * dialog. The orchestrating dialog combines `isPending` across providers and
 * calls `reset()` on close.
 */
export function useRazorpaySettings(open: boolean) {
  const { keys, isLoading, error, saveKey, removeKey } = useRazorpayConfig();
  const { syncPayments } = useRazorpaySync();
  const { rotateWebhookSecret } = useRazorpayWebhook();

  const [keyIdInputs, setKeyIdInputs] = useState<Record<PaymentEnvironment, string>>(
    createEmptyEnvironmentValues
  );
  const [keySecretInputs, setKeySecretInputs] = useState<Record<PaymentEnvironment, string>>(
    createEmptyEnvironmentValues
  );
  const [visibleKeys, setVisibleKeys] = useState<Record<PaymentEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<PaymentEnvironment, string>>>({});
  const previousSavedKeyIds = useRef<Record<PaymentEnvironment, string>>(
    createEmptyEnvironmentValues()
  );
  const previousSavedKeySecrets = useRef<Record<PaymentEnvironment, string>>(
    createEmptyEnvironmentValues()
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextSavedKeyIds = getRazorpayKeyValues(keys, 'api_key');
    const nextSavedKeySecrets = getRazorpayKeyValues(keys, 'api_secret');

    setKeyIdInputs((current) =>
      hydrateEnvironmentValues(current, previousSavedKeyIds.current, nextSavedKeyIds)
    );
    setKeySecretInputs((current) =>
      hydrateEnvironmentValues(current, previousSavedKeySecrets.current, nextSavedKeySecrets)
    );

    previousSavedKeyIds.current = nextSavedKeyIds;
    previousSavedKeySecrets.current = nextSavedKeySecrets;
  }, [open, keys]);

  const isPending =
    saveKey.isPending ||
    removeKey.isPending ||
    syncPayments.isPending ||
    rotateWebhookSecret.isPending;

  const reset = () => {
    setKeyIdInputs(createEmptyEnvironmentValues());
    setKeySecretInputs(createEmptyEnvironmentValues());
    setVisibleKeys({ test: false, live: false });
    setErrors({});

    saveKey.reset();
    removeKey.reset();
    syncPayments.reset();
    rotateWebhookSecret.reset();
  };

  const handleIdInputChange = (environment: PaymentEnvironment, value: string) => {
    setKeyIdInputs((current) => ({ ...current, [environment]: value }));
  };

  const handleSecretInputChange = (environment: PaymentEnvironment, value: string) => {
    setKeySecretInputs((current) => ({ ...current, [environment]: value }));
  };

  const handleToggleShowKey = (environment: PaymentEnvironment) => {
    setVisibleKeys((current) => ({ ...current, [environment]: !current[environment] }));
  };

  const handleSave = (environment: PaymentEnvironment) => {
    const keyId = keyIdInputs[environment].trim();
    const secretKey = keySecretInputs[environment].trim();
    const expectedPrefix = RAZORPAY_PREFIX_BY_ENVIRONMENT[environment];

    if (!keyId || !secretKey) {
      setErrors((current) => ({
        ...current,
        [environment]: 'Please enter both Key ID and Key Secret.',
      }));
      return;
    }

    if (!keyId.startsWith(expectedPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: `Razorpay Key ID must start with ${expectedPrefix}`,
      }));
      return;
    }

    setErrors((current) => ({ ...current, [environment]: undefined }));
    saveKey.mutate({ environment, keyId, keySecret: secretKey });
  };

  const handleRemove = async (environment: PaymentEnvironment) => {
    setErrors((current) => ({ ...current, [environment]: undefined }));
    try {
      await removeKey.mutateAsync(environment);
      setKeyIdInputs((current) => ({ ...current, [environment]: '' }));
      setKeySecretInputs((current) => ({ ...current, [environment]: '' }));
      setVisibleKeys((current) => ({ ...current, [environment]: false }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to remove Razorpay keys.',
      }));
    }
  };

  return {
    keys,
    isLoading,
    error,
    syncPayments,
    rotateWebhookSecret,
    keyIdInputs,
    keySecretInputs,
    visibleKeys,
    errors,
    configuredKeys: getConfiguredRazorpayApiKeys(keys),
    isPending,
    reset,
    handleIdInputChange,
    handleSecretInputChange,
    handleToggleShowKey,
    handleSave,
    handleRemove,
  };
}

export type RazorpaySettingsState = ReturnType<typeof useRazorpaySettings>;

export function RazorpaySettingsPanel({
  activeTab,
  state,
  isBusy,
  onGoToKeys,
}: {
  activeTab: PaymentsSettingsTab;
  state: RazorpaySettingsState;
  isBusy: boolean;
  onGoToKeys: () => void;
}) {
  if (activeTab === 'keys') {
    return (
      <RazorpayKeysTabContent
        keys={state.keys}
        isLoading={state.isLoading}
        error={state.error}
        isBusy={isBusy}
        keyIdInputs={state.keyIdInputs}
        keySecretInputs={state.keySecretInputs}
        visibleKeys={state.visibleKeys}
        errors={state.errors}
        onIdInputChange={state.handleIdInputChange}
        onSecretInputChange={state.handleSecretInputChange}
        onToggleShowKey={state.handleToggleShowKey}
        onSave={state.handleSave}
        onRemove={(environment) => void state.handleRemove(environment)}
      />
    );
  }

  if (activeTab === 'webhooks') {
    return (
      <RazorpayWebhooksTabContent
        keys={state.keys}
        rotateWebhookSecret={state.rotateWebhookSecret}
        isBusy={isBusy}
        onGoToKeys={onGoToKeys}
      />
    );
  }

  return (
    <SyncTabContent
      isLoading={state.isLoading}
      error={state.error}
      configuredKeys={state.configuredKeys}
      isSyncing={state.syncPayments.isPending}
      syncError={state.syncPayments.error}
      onSync={() => void state.syncPayments.mutateAsync({ environment: 'all' })}
      provider="razorpay"
    />
  );
}

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
  keyIdInputs: Record<PaymentEnvironment, string>;
  keySecretInputs: Record<PaymentEnvironment, string>;
  visibleKeys: Record<PaymentEnvironment, boolean>;
  errors: Partial<Record<PaymentEnvironment, string>>;
  onIdInputChange: (environment: PaymentEnvironment, value: string) => void;
  onSecretInputChange: (environment: PaymentEnvironment, value: string) => void;
  onToggleShowKey: (environment: PaymentEnvironment) => void;
  onSave: (environment: PaymentEnvironment) => void;
  onRemove: (environment: PaymentEnvironment) => void;
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

          const hasAnyKey = Boolean(envIdKey?.value || envSecretKey?.value);
          const expectedPrefix = RAZORPAY_PREFIX_BY_ENVIRONMENT[environment];
          const environmentLabel = environment === 'test' ? 'Test Mode' : 'Live Mode';
          const savedKeyId = envIdKey?.value ?? '';
          const savedKeySecret = envSecretKey?.value ?? '';
          const hasPendingInput =
            keyIdInputs[environment].trim() !== savedKeyId.trim() ||
            keySecretInputs[environment].trim() !== savedKeySecret.trim();
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
                          aria-label={
                            visibleKeys[environment] ? 'Hide key secret' : 'Show key secret'
                          }
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

                  {(hasAnyKey || hasPendingInput) && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <div className="flex items-center gap-2">
                        {hasAnyKey && (
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

function RazorpayWebhooksTabContent({
  keys,
  rotateWebhookSecret,
  isBusy,
  onGoToKeys,
}: {
  keys: RazorpayKeyConfig[];
  rotateWebhookSecret: ReturnType<typeof useRazorpayWebhook>['rotateWebhookSecret'];
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
            rotateWebhookSecret={rotateWebhookSecret}
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
  rotateWebhookSecret,
  isBusy,
  onGoToKeys,
}: {
  environment: PaymentEnvironment;
  keys: RazorpayKeyConfig[];
  rotateWebhookSecret: ReturnType<typeof useRazorpayWebhook>['rotateWebhookSecret'];
  isBusy: boolean;
  onGoToKeys: () => void;
}) {
  const [isRotateConfirmOpen, setIsRotateConfirmOpen] = useState(false);
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';
  const hasKeyId = keys.some(
    (key) => key.environment === environment && key.keyType === 'api_key' && Boolean(key.value)
  );
  const hasKeySecret = keys.some(
    (key) => key.environment === environment && key.keyType === 'api_secret' && Boolean(key.value)
  );
  const isKeyConfigured = hasKeyId && hasKeySecret;
  const setupQuery = useRazorpayWebhookSetup(environment, isKeyConfigured);
  const setup = setupQuery.data ?? null;
  const isWebhookUrlPublic = setup ? isPublicHttpsWebhookUrl(setup.webhookUrl) : true;
  const isRotating = rotateWebhookSecret.isPending && rotateWebhookSecret.variables === environment;

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
                  onClick={() => setIsRotateConfirmOpen(true)}
                >
                  {isRotating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Rotate
                </Button>
              </div>
            </div>
          </div>

          <ConfirmDialog
            open={isRotateConfirmOpen}
            onOpenChange={setIsRotateConfirmOpen}
            title="Rotate Razorpay webhook secret?"
            description="Rotating the webhook secret will break existing Razorpay webhook deliveries until you update the secret in Razorpay Dashboard."
            cancelText="Cancel"
            confirmText="Rotate"
            destructive
            isLoading={isRotating}
            onConfirm={async () => {
              await rotateWebhookSecret.mutateAsync(environment);
            }}
          />
        </div>
      )}
    </SettingRow>
  );
}
