import { Settings } from 'lucide-react';
import { Button } from '@insforge/ui';
import type { StripeEnvironment } from '@insforge/shared-schemas';
import StripeWordmark from '#assets/logos/stripe-wordmark.svg';

const STRIPE_KEY_NAMES: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

const STRIPE_MODE_LABELS: Record<StripeEnvironment, string> = {
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
  const keyName = STRIPE_KEY_NAMES[environment];
  const modeLabel = STRIPE_MODE_LABELS[environment];

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
        <div className="flex h-20 items-center justify-center">
          <img alt="Stripe" src={StripeWordmark} className="h-20 w-20 object-contain" />
        </div>

        <div className="flex w-full flex-col items-center gap-2">
          <h2 className="text-sm font-medium leading-6 text-foreground">
            Configure Your Stripe {modeLabel} Key
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
          Configure Stripe API keys
        </Button>
      </div>
    </div>
  );
}
