import { Box, Rocket, Settings } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@insforge/ui';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { PaymentProviderSelect } from './PaymentProviderSelect';
import { usePaymentConnectionStatus } from '#features/payments/hooks/usePaymentConnectionStatus';

const PAYMENT_ENVIRONMENT_LABELS: Record<PaymentEnvironment, string> = {
  test: 'Test Environment',
  live: 'Live Environment',
};

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

function getPaymentsSidebarItems(disabled: boolean): FeatureSidebarListItem[] {
  return [
    {
      id: 'catalog',
      label: 'Catalog',
      href: '/dashboard/payments/catalog',
      disabled,
    },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      href: '/dashboard/payments/subscriptions',
      disabled,
    },
    {
      id: 'customers',
      label: 'Customers',
      href: '/dashboard/payments/customers',
      disabled,
    },
    {
      id: 'transactions',
      label: 'Transactions',
      href: '/dashboard/payments/transactions',
      disabled,
    },
  ];
}

const PAYMENTS_FALLBACK_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'catalog',
    label: 'Catalog',
    href: '/dashboard/payments/catalog',
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    href: '/dashboard/payments/subscriptions',
  },
  {
    id: 'customers',
    label: 'Customers',
    href: '/dashboard/payments/customers',
  },
  {
    id: 'transactions',
    label: 'Transactions',
    href: '/dashboard/payments/transactions',
  },
];

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
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as PaymentEnvironment)}
    >
      <SelectTrigger className="h-8 w-full rounded" aria-label="Payment environment">
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
            {PAYMENT_ENVIRONMENT_LABELS[item]}
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
  const { hasActiveKey, isLoading } = usePaymentConnectionStatus(provider, environment);
  const menuDisabled = !isLoading && !hasActiveKey;
  const sidebarItems = isLoading
    ? PAYMENTS_FALLBACK_SIDEBAR_ITEMS
    : getPaymentsSidebarItems(menuDisabled);
  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'payments-settings',
      label: 'Payments Settings',
      icon: Settings,
      onClick: onOpenSettings,
    },
  ];

  return (
    <FeatureSidebar
      title="Payment"
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
          No payment sections available
        </div>
      }
    />
  );
}
