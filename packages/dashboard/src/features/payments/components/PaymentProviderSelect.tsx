import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@insforge/ui';
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

function PaymentProviderSelectIcon({
  provider,
  className,
}: {
  provider: PaymentProvider;
  className?: string;
}) {
  if (provider === 'razorpay') {
    return (
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded bg-white p-0.5',
          className
        )}
      >
        <img
          src={PAYMENT_PROVIDER_ICONS[provider]}
          alt=""
          aria-hidden="true"
          className="size-4 object-contain"
        />
      </span>
    );
  }

  return (
    <img
      src={PAYMENT_PROVIDER_ICONS[provider]}
      alt=""
      aria-hidden="true"
      className={cn('size-5 shrink-0 rounded-[3px] object-contain', className)}
    />
  );
}

export function PaymentProviderSelect({
  value,
  onValueChange,
  triggerClassName = 'h-9 w-[132px]',
  contentClassName = 'w-[132px]',
  ariaLabel,
}: PaymentProviderSelectProps) {
  const { t } = useTranslation('chrome');
  const resolvedAriaLabel =
    ariaLabel ?? t('payments.providerAriaLabel', { defaultValue: 'Payment provider' });
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as PaymentProvider)}
    >
      <SelectTrigger className={triggerClassName} aria-label={resolvedAriaLabel}>
        <span className="!flex min-w-0 items-center gap-2.5">
          <PaymentProviderSelectIcon provider={value} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end" className={contentClassName}>
        {PAYMENT_PROVIDERS.map((provider) => (
          <SelectItem
            key={provider}
            value={provider}
            icon={<PaymentProviderSelectIcon provider={provider} className="mr-1.5" />}
          >
            {PAYMENT_PROVIDER_LABELS[provider]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
