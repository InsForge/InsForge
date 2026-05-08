import { Settings } from 'lucide-react';
import type { StripeEnvironment } from '@insforge/shared-schemas';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import { cn } from '#lib/utils/utils';

const PAYMENTS_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'catalog',
    label: 'Catalog',
    href: '/dashboard/payments/catalog',
  },
  {
    id: 'customers',
    label: 'Customers',
    href: '/dashboard/payments/customers',
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    href: '/dashboard/payments/subscriptions',
  },
  {
    id: 'payment-history',
    label: 'Payment History',
    href: '/dashboard/payments/payment-history',
  },
];

interface PaymentsSidebarProps {
  environment: StripeEnvironment;
  onEnvironmentChange: (environment: StripeEnvironment) => void;
  onOpenSettings: () => void;
}

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

function PaymentsEnvironmentToggle({
  environment,
  onEnvironmentChange,
}: {
  environment: StripeEnvironment;
  onEnvironmentChange: (environment: StripeEnvironment) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--alpha-8)] bg-alpha-4">
        {ENVIRONMENTS.map((item) => {
          const isActive = item === environment;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onEnvironmentChange(item)}
              className={cn(
                'px-3 py-1.5 text-sm leading-5 transition-colors',
                isActive
                  ? 'bg-toast text-foreground'
                  : 'text-muted-foreground hover:bg-alpha-8 hover:text-foreground'
              )}
            >
              {item === 'test' ? 'Test' : 'Live'}
            </button>
          );
        })}
      </div>
      <div className="h-px bg-[var(--alpha-8)]" />
    </div>
  );
}

export function PaymentsSidebar({
  environment,
  onEnvironmentChange,
  onOpenSettings,
}: PaymentsSidebarProps) {
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
      title="Payments"
      items={PAYMENTS_SIDEBAR_ITEMS}
      headerButtons={headerButtons}
      headerContent={
        <PaymentsEnvironmentToggle
          environment={environment}
          onEnvironmentChange={onEnvironmentChange}
        />
      }
    />
  );
}
