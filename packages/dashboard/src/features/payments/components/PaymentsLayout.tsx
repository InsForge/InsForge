import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { PaymentsSidebar } from './PaymentsSidebar';
import { PaymentsSettingsDialog } from './PaymentsSettingsDialog';

export interface PaymentsOutletContext {
  openPaymentsSettings: () => void;
}

export default function PaymentsLayout() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <PaymentsSidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet context={{ openPaymentsSettings: () => setIsSettingsOpen(true) }} />
      </div>
      <PaymentsSettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
