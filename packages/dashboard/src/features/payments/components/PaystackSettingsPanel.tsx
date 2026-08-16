import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button, CopyButton } from '@insforge/ui';
import type {
  PaymentEnvironment,
  PaystackConnectionStatus,
  PaystackKeyConfig,
} from '@insforge/shared-schemas';
import { usePaystackConfig } from '#features/payments/hooks/usePaystackConfig';
import { usePaystackWebhookSetup } from '#features/payments/hooks/usePaystackWebhook';
import {
  DialogSectionDivider,
  SettingRow,
  type PaymentsSettingsTab,
} from './PaymentsSettingsDialog';
import { ENVIRONMENTS } from '#features/payments/helpers';
import { useEnvironmentValueInputs } from '#features/payments/hooks/useEnvironmentValueInputs';

const PAYSTACK_SECRET_KEY_PREFIX_BY_ENVIRONMENT: Record<PaymentEnvironment, string> = {
  test: 'sk_test_',
  live: 'sk_live_',
};
const PAYSTACK_PUBLIC_KEY_PREFIX_BY_ENVIRONMENT: Record<PaymentEnvironment, string> = {
  test: 'pk_test_',
  live: 'pk_live_',
};
const PAYSTACK_WEBHOOK_DOCS_URL = 'https://paystack.com/docs/payments/webhooks/';
const PAYSTACK_HANDLED_WEBHOOK_EVENTS = ['charge.success', 'refund.processed', 'refund.failed'];

function getPaystackKeyValue(
  keys: PaystackKeyConfig[],
  environment: PaymentEnvironment,
  keyType: PaystackKeyConfig['keyType']
): string {
  return (
    keys.find((key) => key.environment === environment && key.keyType === keyType)?.value ?? ''
  );
}

function getPaystackKeyValues(
  keys: PaystackKeyConfig[],
  keyType: PaystackKeyConfig['keyType']
): Record<PaymentEnvironment, string> {
  return {
    test: getPaystackKeyValue(keys, 'test', keyType),
    live: getPaystackKeyValue(keys, 'live', keyType),
  };
}

// Hosts that Paystack's servers can't reach, so a webhook pointed at them would
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
 * Owns the Paystack-side hooks and form state for the payments settings
 * dialog. The orchestrating dialog combines `isPending` across providers and
 * calls `reset()` on close.
 */
export function usePaystackSettings(open: boolean) {
  const { keys, isLoading, error, saveKey, removeKey } = usePaystackConfig();

  const secretKeyInputs = useEnvironmentValueInputs();
  const publicKeyInputs = useEnvironmentValueInputs();
  const { hydrateFromSaved: hydrateSecretKey } = secretKeyInputs;
  const { hydrateFromSaved: hydratePublicKey } = publicKeyInputs;
  const [visibleKeys, setVisibleKeys] = useState<Record<PaymentEnvironment, boolean>>({
    test: false,
    live: false,
  });
  const [errors, setErrors] = useState<Partial<Record<PaymentEnvironment, string>>>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    hydrateSecretKey(getPaystackKeyValues(keys, 'secret_key'));
    hydratePublicKey(getPaystackKeyValues(keys, 'public_key'));
  }, [open, keys, hydrateSecretKey, hydratePublicKey]);

  const isPending = saveKey.isPending || removeKey.isPending;

  const reset = () => {
    secretKeyInputs.reset();
    publicKeyInputs.reset();
    setVisibleKeys({ test: false, live: false });
    setErrors({});

    saveKey.reset();
    removeKey.reset();
  };

  const handleSecretInputChange = (environment: PaymentEnvironment, value: string) => {
    secretKeyInputs.setValue(environment, value);
  };

  const handlePublicInputChange = (environment: PaymentEnvironment, value: string) => {
    publicKeyInputs.setValue(environment, value);
  };

  const handleToggleShowKey = (environment: PaymentEnvironment) => {
    setVisibleKeys((current) => ({ ...current, [environment]: !current[environment] }));
  };

  const handleSave = (environment: PaymentEnvironment) => {
    const secretKey = secretKeyInputs.values[environment].trim();
    const publicKey = publicKeyInputs.values[environment].trim();
    const savedPublicKey = getPaystackKeyValue(keys, environment, 'public_key');
    const expectedSecretPrefix = PAYSTACK_SECRET_KEY_PREFIX_BY_ENVIRONMENT[environment];
    const expectedPublicPrefix = PAYSTACK_PUBLIC_KEY_PREFIX_BY_ENVIRONMENT[environment];

    if (!secretKey) {
      setErrors((current) => ({
        ...current,
        [environment]: 'Please enter a Secret Key.',
      }));
      return;
    }

    if (!secretKey.startsWith(expectedSecretPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: `Paystack Secret Key must start with ${expectedSecretPrefix}`,
      }));
      return;
    }

    if (publicKey && !publicKey.startsWith(expectedPublicPrefix)) {
      setErrors((current) => ({
        ...current,
        [environment]: `Paystack Public Key must start with ${expectedPublicPrefix}`,
      }));
      return;
    }

    setErrors((current) => ({ ...current, [environment]: undefined }));
    // The public key input hydrates with the saved raw value, so an empty
    // input alongside a configured key means the user cleared it: send null to
    // clear. With no key configured, an empty input stays a no-op (undefined =
    // keep existing), so a secret-key-only edit never touches the public key.
    saveKey.mutate({
      environment,
      secretKey,
      publicKey: publicKey || (savedPublicKey ? null : undefined),
    });
  };

  const handleRemove = async (environment: PaymentEnvironment) => {
    setErrors((current) => ({ ...current, [environment]: undefined }));
    try {
      await removeKey.mutateAsync(environment);
      secretKeyInputs.clear(environment);
      publicKeyInputs.clear(environment);
      setVisibleKeys((current) => ({ ...current, [environment]: false }));
    } catch (err) {
      setErrors((current) => ({
        ...current,
        [environment]: err instanceof Error ? err.message : 'Failed to remove Paystack keys.',
      }));
    }
  };

  return {
    keys,
    isLoading,
    error,
    secretKeyInputs: secretKeyInputs.values,
    publicKeyInputs: publicKeyInputs.values,
    visibleKeys,
    errors,
    isPending,
    reset,
    handleSecretInputChange,
    handlePublicInputChange,
    handleToggleShowKey,
    handleSave,
    handleRemove,
  };
}

export type PaystackSettingsState = ReturnType<typeof usePaystackSettings>;

export function PaystackSettingsPanel({
  activeTab,
  state,
  isBusy,
  onGoToKeys,
}: {
  activeTab: PaymentsSettingsTab;
  state: PaystackSettingsState;
  isBusy: boolean;
  onGoToKeys: () => void;
}) {
  if (activeTab === 'keys') {
    return (
      <PaystackKeysTabContent
        keys={state.keys}
        isLoading={state.isLoading}
        error={state.error}
        isBusy={isBusy}
        secretKeyInputs={state.secretKeyInputs}
        publicKeyInputs={state.publicKeyInputs}
        visibleKeys={state.visibleKeys}
        errors={state.errors}
        onSecretInputChange={state.handleSecretInputChange}
        onPublicInputChange={state.handlePublicInputChange}
        onToggleShowKey={state.handleToggleShowKey}
        onSave={state.handleSave}
        onRemove={(environment) => void state.handleRemove(environment)}
      />
    );
  }

  if (activeTab === 'webhooks') {
    return <PaystackWebhooksTabContent keys={state.keys} onGoToKeys={onGoToKeys} />;
  }

  // Paystack has no sync flow; the dialog hides the Sync tab for this provider.
  return null;
}

function PaystackKeysTabContent({
  keys,
  isLoading,
  error,
  isBusy,
  secretKeyInputs,
  publicKeyInputs,
  visibleKeys,
  errors,
  onSecretInputChange,
  onPublicInputChange,
  onToggleShowKey,
  onSave,
  onRemove,
}: {
  keys: PaystackKeyConfig[];
  isLoading: boolean;
  error: unknown;
  isBusy: boolean;
  secretKeyInputs: Record<PaymentEnvironment, string>;
  publicKeyInputs: Record<PaymentEnvironment, string>;
  visibleKeys: Record<PaymentEnvironment, boolean>;
  errors: Partial<Record<PaymentEnvironment, string>>;
  onSecretInputChange: (environment: PaymentEnvironment, value: string) => void;
  onPublicInputChange: (environment: PaymentEnvironment, value: string) => void;
  onToggleShowKey: (environment: PaymentEnvironment) => void;
  onSave: (environment: PaymentEnvironment) => void;
  onRemove: (environment: PaymentEnvironment) => void;
}) {
  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Paystack key configuration...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load Paystack key configuration. Close the dialog and try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Configure the Paystack API Keys to use Payments.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {ENVIRONMENTS.map((environment, index) => {
          const envSecretKey = keys.find(
            (key) => key.environment === environment && key.keyType === 'secret_key'
          );
          const envPublicKey = keys.find(
            (key) => key.environment === environment && key.keyType === 'public_key'
          );

          const hasAnyKey = Boolean(envSecretKey?.value || envPublicKey?.value);
          const expectedSecretPrefix = PAYSTACK_SECRET_KEY_PREFIX_BY_ENVIRONMENT[environment];
          const expectedPublicPrefix = PAYSTACK_PUBLIC_KEY_PREFIX_BY_ENVIRONMENT[environment];
          const environmentLabel = environment === 'test' ? 'Test Mode' : 'Live Mode';
          const savedSecretKey = envSecretKey?.value ?? '';
          const savedPublicKey = envPublicKey?.value ?? '';
          const hasPendingInput =
            secretKeyInputs[environment].trim() !== savedSecretKey.trim() ||
            publicKeyInputs[environment].trim() !== savedPublicKey.trim();
          const secretKeyInputId = `paystack-${environment}-secret-key`;
          const publicKeyInputId = `paystack-${environment}-public-key`;

          return (
            <div key={environment} className="flex flex-col gap-2">
              <SettingRow
                label={environmentLabel}
                description={
                  <>
                    Use a Paystack Secret Key that starts with{' '}
                    <span className="font-mono text-foreground">{expectedSecretPrefix}</span>. The
                    matching Public Key is optional.
                  </>
                }
              >
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                      <label
                        htmlFor={secretKeyInputId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Secret Key
                      </label>
                      <div className="relative">
                        <input
                          id={secretKeyInputId}
                          type={visibleKeys[environment] ? 'text' : 'password'}
                          value={secretKeyInputs[environment]}
                          onChange={(event) => onSecretInputChange(environment, event.target.value)}
                          placeholder={`${expectedSecretPrefix}...`}
                          disabled={isBusy}
                          className="h-8 w-full rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 pr-9 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))] hover:bg-[var(--alpha-4)] disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => onToggleShowKey(environment)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          aria-label={
                            visibleKeys[environment] ? 'Hide secret key' : 'Show secret key'
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
                    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3">
                      <label
                        htmlFor={publicKeyInputId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Public Key
                      </label>
                      <input
                        id={publicKeyInputId}
                        type="text"
                        value={publicKeyInputs[environment]}
                        onChange={(event) => onPublicInputChange(environment, event.target.value)}
                        placeholder={`${expectedPublicPrefix}... (optional)`}
                        disabled={isBusy}
                        className="h-8 w-full rounded border border-[var(--alpha-12)] bg-[var(--alpha-4)] px-2.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--inverse)),0_0_0_2px_rgb(var(--foreground))] hover:bg-[var(--alpha-4)] disabled:opacity-50"
                      />
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

function PaystackWebhooksTabContent({
  keys,
  onGoToKeys,
}: {
  keys: PaystackKeyConfig[];
  onGoToKeys: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm leading-6 text-muted-foreground">
          Paystack webhooks must be added manually in the Paystack Dashboard.
        </p>
      </div>

      {ENVIRONMENTS.map((environment, index) => (
        <div key={environment} className="flex flex-col gap-2">
          <PaystackWebhookEnvironmentSection
            environment={environment}
            keys={keys}
            onGoToKeys={onGoToKeys}
          />
          {index < ENVIRONMENTS.length - 1 && <DialogSectionDivider />}
        </div>
      ))}

      <PaystackWebhookManualSetupGuidance />
    </div>
  );
}

function PaystackWebhookManualSetupGuidance() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border border-[var(--alpha-8)] p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Manual setup steps</p>
          <a
            href={PAYSTACK_WEBHOOK_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Paystack docs
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs leading-5 text-muted-foreground">
          <li>Open Paystack Dashboard and go to Settings → API Keys &amp; Webhooks.</li>
          <li>
            Paste the matching environment&apos;s Webhook URL above into the Test or Live Webhook
            URL field.
          </li>
          <li>Save the changes, then make a test payment to verify delivery.</li>
        </ol>
      </div>

      <div className="rounded border border-[var(--alpha-8)] p-3">
        <p className="text-sm font-medium text-foreground">Events handled by InsForge</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PAYSTACK_HANDLED_WEBHOOK_EVENTS.map((event) => (
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

function PaystackConnectionStatusBadge({ status }: { status: PaystackConnectionStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className="inline-flex w-fit items-center rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        Error
      </span>
    );
  }

  return (
    <span className="inline-flex w-fit items-center rounded-full border border-[var(--alpha-8)] bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Not connected
    </span>
  );
}

function PaystackWebhookEnvironmentSection({
  environment,
  keys,
  onGoToKeys,
}: {
  environment: PaymentEnvironment;
  keys: PaystackKeyConfig[];
  onGoToKeys: () => void;
}) {
  const environmentLabel = environment === 'test' ? 'Test mode' : 'Live mode';
  const isKeyConfigured = keys.some(
    (key) => key.environment === environment && key.keyType === 'secret_key' && Boolean(key.value)
  );
  const setupQuery = usePaystackWebhookSetup(environment, isKeyConfigured);
  const setup = setupQuery.data ?? null;
  const isWebhookUrlPublic = setup ? isPublicHttpsWebhookUrl(setup.webhookUrl) : true;

  return (
    <SettingRow
      orientation="vertical"
      label={environmentLabel}
      description={
        isKeyConfigured
          ? 'Copy this value into the Paystack Dashboard for this environment.'
          : 'Configure Paystack keys first.'
      }
    >
      {!isKeyConfigured ? (
        <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">Configure Paystack keys first.</p>
          <Button type="button" size="sm" className="mt-3 h-8" onClick={onGoToKeys}>
            Connection Keys
          </Button>
        </div>
      ) : setupQuery.isLoading ? (
        <div className="flex min-h-[96px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Paystack webhook setup values...
        </div>
      ) : setupQuery.error || !setup ? (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          Failed to load Paystack webhook setup values. Close the dialog and try again.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded border border-[var(--alpha-8)] bg-muted/40 p-3">
            <div className="grid gap-3 text-xs">
              <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
                <span className="text-muted-foreground">Status</span>
                <PaystackConnectionStatusBadge status={setup.connection.status} />
              </div>
              <div className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-muted-foreground">Webhook URL</span>
                <span className="min-w-0 break-all font-mono text-foreground">
                  {setup.webhookUrl}
                </span>
                <CopyButton text={setup.webhookUrl} showText={false} />
              </div>
              {!isWebhookUrlPublic && (
                <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                  Paystack can only deliver webhooks to a public HTTPS URL.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </SettingRow>
  );
}
