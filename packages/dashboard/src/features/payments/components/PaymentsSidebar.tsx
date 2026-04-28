import { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '../../../components';
import { PaymentsSettingsDialog } from './PaymentsSettingsDialog';

const PAYMENTS_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'products',
    label: 'Products',
    href: '/dashboard/payments/products',
  },
];

export function PaymentsSidebar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'payments-settings',
      label: 'Payments Settings',
      icon: Settings,
      onClick: () => setIsSettingsOpen(true),
    },
  ];

  return (
    <>
      <FeatureSidebar
        title="Payments"
        items={PAYMENTS_SIDEBAR_ITEMS}
        headerButtons={headerButtons}
      />
      <PaymentsSettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
