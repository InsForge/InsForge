import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { StripeEnvironment } from '@insforge/shared-schemas';
import { PaymentsSidebar } from './PaymentsSidebar';
import { PaymentsSettingsDialog } from './PaymentsSettingsDialog';

export interface PaymentsOutletContext {
  openPaymentsSettings: () => void;
  environment: StripeEnvironment;
  setEnvironment: (environment: StripeEnvironment) => void;
}

export default function PaymentsLayout() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [environment, setEnvironment] = useState<StripeEnvironment>('test');

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <PaymentsSidebar
        environment={environment}
        onEnvironmentChange={setEnvironment}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet
          context={{
            openPaymentsSettings: () => setIsSettingsOpen(true),
            environment,
            setEnvironment,
          }}
        />
      </div>
      <PaymentsSettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
