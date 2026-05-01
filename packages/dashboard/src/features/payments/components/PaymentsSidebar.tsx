import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '../../../components';

const PAYMENTS_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'products',
    label: 'Products',
    href: '/dashboard/payments/products',
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
  onOpenSettings: () => void;
}

export function PaymentsSidebar({ onOpenSettings }: PaymentsSidebarProps) {
  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'payments-settings',
      label: 'Payments Settings',
      icon: Settings,
      onClick: onOpenSettings,
    },
  ];

  return (
    <FeatureSidebar title="Payments" items={PAYMENTS_SIDEBAR_ITEMS} headerButtons={headerButtons} />
  );
}
