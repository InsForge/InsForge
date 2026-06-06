import { Settings, CreditCard } from 'lucide-react';
import { Button } from '@insforge/ui';
import type { StripeEnvironment } from '@insforge/shared-schemas';
const STRIPE_KEY_NAMES: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

const RAZORPAY_KEY_NAMES: Record<StripeEnvironment, string> = {
  test: 'RAZORPAY_TEST_KEY_SECRET',
  live: 'RAZORPAY_LIVE_KEY_SECRET',
};

const MODE_LABELS: Record<StripeEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

interface PaymentsKeyMissingStateProps {
  environment: StripeEnvironment;
  resourceLabel: string;
  onConfigure: () => void;
}

export function PaymentsKeyMissingState({
  environment,
  resourceLabel,
  onConfigure,
}: PaymentsKeyMissingStateProps) {
  const stripeKeyName = STRIPE_KEY_NAMES[environment];
  const razorpayKeyName = RAZORPAY_KEY_NAMES[environment];
  const modeLabel = MODE_LABELS[environment];

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6">
      <div className="flex w-full max-w-[800px] flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <h2 className="text-lg font-medium leading-7 text-foreground">
            Configure a Payment Provider
          </h2>
          <p className="max-w-[400px] text-sm leading-5 text-muted-foreground">
            To view {environment} {resourceLabel}, you need to configure either Stripe or Razorpay
            API keys.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
          {/* Stripe Card */}
          <div className="flex flex-col items-center gap-4 rounded-xl border border-[var(--alpha-8)] bg-muted/20 p-6">
            <div className="flex h-12 items-center justify-center">
              <div className="flex items-center gap-2 text-foreground/80 font-bold tracking-tight text-xl">
                <CreditCard className="h-6 w-6 text-indigo-500" />
                Stripe
              </div>
            </div>
            <div className="flex w-full flex-col items-center gap-1">
              <h3 className="text-sm font-medium text-foreground">Stripe {modeLabel} Keys</h3>
              <p className="text-xs text-muted-foreground">Add {stripeKeyName}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onConfigure} className="mt-2 w-full">
              <Settings className="mr-2 h-4 w-4" />
              Configure Stripe
            </Button>
          </div>

          {/* Razorpay Card */}
          <div className="flex flex-col items-center gap-4 rounded-xl border border-[var(--alpha-8)] bg-muted/20 p-6">
            <div className="flex h-12 items-center justify-center">
              <div className="flex items-center gap-2 text-foreground/80 font-bold tracking-tight text-xl">
                <CreditCard className="h-6 w-6 text-blue-500" />
                Razorpay
              </div>
            </div>
            <div className="flex w-full flex-col items-center gap-1">
              <h3 className="text-sm font-medium text-foreground">Razorpay {modeLabel} Keys</h3>
              <p className="text-xs text-muted-foreground">Add {razorpayKeyName}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onConfigure} className="mt-2 w-full">
              <Settings className="mr-2 h-4 w-4" />
              Configure Razorpay
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
