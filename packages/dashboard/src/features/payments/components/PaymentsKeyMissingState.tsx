import { Settings } from 'lucide-react';
import { Button } from '@insforge/ui';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import RazorpayLogo from '#assets/logos/razorpay-logo.svg?react';
import StripeWordmark from '#assets/logos/stripe-wordmark.svg';

const KEY_NAMES: Record<PaymentProvider, Record<PaymentEnvironment, string>> = {
  stripe: {
    test: 'STRIPE_TEST_SECRET_KEY',
    live: 'STRIPE_LIVE_SECRET_KEY',
  },
  razorpay: {
    test: 'RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET',
    live: 'RAZORPAY_LIVE_KEY_ID and RAZORPAY_LIVE_KEY_SECRET',
  },
};

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  razorpay: 'Razorpay',
};

const MODE_LABELS: Record<PaymentEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

interface PaymentsKeyMissingStateProps {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  resourceLabel: string;
  onConfigure: () => void;
}

function PaymentProviderLogo({ provider, label }: { provider: PaymentProvider; label: string }) {
  if (provider === 'stripe') {
    return <img alt={label} src={StripeWordmark} className="h-20 w-20 object-contain" />;
  }

  return (
    <RazorpayLogo
      role="img"
      aria-label={label}
      className="h-16 w-36"
      style={{ fill: 'rgb(var(--foreground))' }}
    />
  );
}

export function PaymentsKeyMissingState({
  provider,
  environment,
  resourceLabel,
  onConfigure,
}: PaymentsKeyMissingStateProps) {
  const providerLabel = PROVIDER_LABELS[provider];
  const keyName = KEY_NAMES[provider][environment];
  const modeLabel = MODE_LABELS[environment];
  const keyLabel = provider === 'stripe' ? 'Key' : 'Keys';

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
        <div className="flex h-20 items-center justify-center">
          <PaymentProviderLogo provider={provider} label={providerLabel} />
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          <h2 className="text-sm font-medium leading-6 text-foreground">
            Configure Your {providerLabel} {modeLabel} {keyLabel}
          </h2>
          <p className="max-w-[320px] text-xs leading-4 text-muted-foreground">
            Add {keyName} before viewing {environment} {resourceLabel}.
          </p>
        </div>

        <Button
          variant="outline"
          size="default"
          onClick={onConfigure}
          className="h-8 rounded px-2.5"
        >
          <Settings className="h-4 w-4" />
          Configure {providerLabel} API keys
        </Button>
      </div>
    </div>
  );
}
