import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@insforge/ui';
import type { PaymentProvider } from '@insforge/shared-schemas';
import RazorpayIcon from '#assets/logos/razorpay-icon.png';
import StripeIcon from '#assets/logos/stripe-icon.svg';

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  razorpay: 'Razorpay',
};

const PAYMENT_PROVIDERS: PaymentProvider[] = ['stripe', 'razorpay'];
const PAYMENT_PROVIDER_ICONS: Record<PaymentProvider, string> = {
  stripe: StripeIcon,
  razorpay: RazorpayIcon,
};

interface PaymentProviderSelectProps {
  value: PaymentProvider;
  onValueChange: (provider: PaymentProvider) => void;
  triggerClassName?: string;
  contentClassName?: string;
  ariaLabel?: string;
}

function PaymentProviderSelectIcon({ provider }: { provider: PaymentProvider }) {
  return (
    <img
      src={PAYMENT_PROVIDER_ICONS[provider]}
      alt=""
      aria-hidden="true"
      className="size-4 shrink-0 rounded-[3px] object-contain"
    />
  );
}

export function PaymentProviderSelect({
  value,
  onValueChange,
  triggerClassName = 'h-9 w-[132px]',
  contentClassName = 'w-[132px]',
  ariaLabel = 'Payment provider',
}: PaymentProviderSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as PaymentProvider)}
    >
      <SelectTrigger className={triggerClassName} aria-label={ariaLabel}>
        <span className="!flex min-w-0 items-center gap-2">
          <PaymentProviderSelectIcon provider={value} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end" className={contentClassName}>
        {PAYMENT_PROVIDERS.map((provider) => (
          <SelectItem
            key={provider}
            value={provider}
            icon={<PaymentProviderSelectIcon provider={provider} />}
          >
            {PAYMENT_PROVIDER_LABELS[provider]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
