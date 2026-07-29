import { Box, Rocket, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@insforge/ui';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { PaymentProviderSelect } from './PaymentProviderSelect';
import { usePaymentConnectionStatus } from '#features/payments/hooks/usePaymentConnectionStatus';

const PAYMENT_ENVIRONMENTS: PaymentEnvironment[] = ['test', 'live'];

const PAYMENT_ENVIRONMENT_ICONS = {
  test: Box,
  live: Rocket,
} satisfies Record<PaymentEnvironment, typeof Box>;

function PaymentEnvironmentIcon({
  environment,
  className,
}: {
  environment: PaymentEnvironment;
  className?: string;
}) {
  const Icon = PAYMENT_ENVIRONMENT_ICONS[environment];

  return <Icon className={cn('size-5 shrink-0 text-muted-foreground', className)} />;
}

interface PaymentsSidebarProps {
  onOpenSettings: () => void;
  provider: PaymentProvider;
  setProvider: (provider: PaymentProvider) => void;
  environment: PaymentEnvironment;
  setEnvironment: (environment: PaymentEnvironment) => void;
}

function PaymentEnvironmentSelect({
  value,
  onValueChange,
}: {
  value: PaymentEnvironment;
  onValueChange: (environment: PaymentEnvironment) => void;
}) {
  const { t } = useTranslation('chrome');
  const environmentLabels: Record<PaymentEnvironment, string> = {
    test: t('payments.testEnvironment', { defaultValue: 'Test Environment' }),
    live: t('payments.liveEnvironment', { defaultValue: 'Live Environment' }),
  };
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as PaymentEnvironment)}
    >
      <SelectTrigger
        className="h-8 w-full rounded"
        aria-label={t('payments.environmentAriaLabel', { defaultValue: 'Payment environment' })}
      >
        <span className="!flex min-w-0 items-center gap-2.5">
          <PaymentEnvironmentIcon environment={value} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent align="end" className="w-[216px]">
        {PAYMENT_ENVIRONMENTS.map((item) => (
          <SelectItem
            key={item}
            value={item}
            icon={<PaymentEnvironmentIcon environment={item} className="mr-1.5" />}
          >
            {environmentLabels[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PaymentsSidebar({
  onOpenSettings,
  provider,
  setProvider,
  environment,
  setEnvironment,
}: PaymentsSidebarProps) {
  const { t } = useTranslation('chrome');
  const { hasActiveKey, isLoading } = usePaymentConnectionStatus(provider, environment);
  const menuDisabled = !isLoading && !hasActiveKey;
  const itemDisabled = isLoading ? undefined : menuDisabled;
  const sidebarItems: FeatureSidebarListItem[] = [
    {
      id: 'catalog',
      label: t('payments.catalog', { defaultValue: 'Catalog' }),
      href: '/dashboard/payments/catalog',
      disabled: itemDisabled,
    },
    {
      id: 'subscriptions',
      label: t('payments.subscriptions', { defaultValue: 'Subscriptions' }),
      href: '/dashboard/payments/subscriptions',
      disabled: itemDisabled,
    },
    {
      id: 'customers',
      label: t('payments.customers', { defaultValue: 'Customers' }),
      href: '/dashboard/payments/customers',
      disabled: itemDisabled,
    },
    {
      id: 'transactions',
      label: t('payments.transactions', { defaultValue: 'Transactions' }),
      href: '/dashboard/payments/transactions',
      disabled: itemDisabled,
    },
  ];
  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'payments-settings',
      label: t('payments.settingsTitle', { defaultValue: 'Payments Settings' }),
      icon: Settings,
      onClick: onOpenSettings,
    },
  ];

  return (
    <FeatureSidebar
      title={t('payments.sidebarTitle', { defaultValue: 'Payment' })}
      items={sidebarItems}
      headerButtons={headerButtons}
      headerContent={
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <PaymentProviderSelect
              value={provider}
              onValueChange={setProvider}
              triggerClassName="h-8 w-full rounded"
              contentClassName="w-[216px]"
            />
            <PaymentEnvironmentSelect value={environment} onValueChange={setEnvironment} />
          </div>
          <div className="h-px w-full bg-alpha-8" />
        </div>
      }
      activeItemId={menuDisabled ? null : undefined}
      emptyState={
        <div
          className={cn('px-2 py-1 text-sm text-muted-foreground', menuDisabled && 'opacity-40')}
        >
          {t('payments.noSectionsAvailable', { defaultValue: 'No payment sections available' })}
        </div>
      }
    />
  );
}
