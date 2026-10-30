import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@insforge/ui';
import type { PaymentProvider, RazorpayKeyConfig, StripeKeyConfig } from '@insforge/shared-schemas';

export type PaymentKeyConfig = StripeKeyConfig | RazorpayKeyConfig;

export function PaymentsSyncTabContent({
  isLoading,
  error,
  configuredKeys,
  isSyncing,
  syncError,
  onSync,
  provider = 'stripe',
}: {
  isLoading: boolean;
  error: unknown;
  configuredKeys: PaymentKeyConfig[];
  isSyncing: boolean;
  syncError: unknown;
  onSync: () => void;
  provider?: PaymentProvider;
}) {
  const { t } = useTranslation('chrome');
  const providerName = provider === 'stripe' ? 'Stripe' : 'Razorpay';
  const syncDescription =
    provider === 'stripe'
      ? t('payments.syncDescriptionStripe', {
          defaultValue:
            'Force a manual sync of Stripe products, prices, customers, and active subscriptions. Normally, Stripe events sync automatically via webhooks.',
        })
      : t('payments.syncDescriptionRazorpay', {
          defaultValue:
            'Force a manual sync of Razorpay items, plans, customers, subscriptions, invoices, and payments. Normally, Razorpay events sync automatically via webhooks.',
        });

  if (isLoading && !error) {
    return (
      <div className="flex min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('payments.loadingKeyConfiguration', {
          defaultValue: 'Loading {{provider}} key configuration...',
          provider: providerName,
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
          provider: providerName,
        })}
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
            <p className="text-sm font-medium text-foreground">
              {t('payments.syncAllEnvironments', {
                defaultValue: 'Sync all configured environments',
              })}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
              {configuredKeys.length > 0
                ? t('payments.configuredEnvironments', {
                    defaultValue: 'Configured: {{environments}}',
                    environments: configuredKeys
                      .map((key) =>
                        key.environment === 'test'
                          ? t('payments.modeTest', { defaultValue: 'Test' })
                          : t('payments.modeLive', { defaultValue: 'Live' })
                      )
                      .join(', '),
                  })
                : t('payments.configureKeyBeforeSync', {
                    defaultValue: 'Configure a {{provider}} test or live key before syncing.',
                    provider: providerName,
                  })}
            </p>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={onSync}
            disabled={isSyncing || configuredKeys.length === 0}
            className="h-9 shrink-0"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('payments.syncPayments', { defaultValue: 'Sync Payments' })}
          </Button>
        </div>
      </div>

      {Boolean(syncError) && (
        <div className="rounded border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {syncError instanceof Error
            ? syncError.message
            : t('payments.syncFailed', {
                defaultValue: 'Failed to sync {{provider}} payments.',
                provider: providerName,
              })}
        </div>
      )}
    </div>
  );
}
