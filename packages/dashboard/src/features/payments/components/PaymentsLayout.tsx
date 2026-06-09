import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import { PaymentsSidebar } from './PaymentsSidebar';
import { PaymentsSettingsDialog } from './PaymentsSettingsDialog';
import { getLocalStorageJSON, setLocalStorageJSON } from '#lib/utils/local-storage';

const PAYMENTS_SELECTION_STORAGE_KEY = 'insforge.payments.selection';

interface PaymentSelection {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
}

const DEFAULT_PAYMENT_SELECTION: PaymentSelection = {
  provider: 'stripe',
  environment: 'test',
};

export interface PaymentsOutletContext {
  openPaymentsSettings: () => void;
  provider: PaymentProvider;
  setProvider: (provider: PaymentProvider) => void;
  environment: PaymentEnvironment;
  setEnvironment: (environment: PaymentEnvironment) => void;
}

function isPaymentProvider(value: unknown): value is PaymentProvider {
  return value === 'stripe' || value === 'razorpay';
}

function isPaymentEnvironment(value: unknown): value is PaymentEnvironment {
  return value === 'test' || value === 'live';
}

function readStoredPaymentSelection(): PaymentSelection {
  const storedSelection = getLocalStorageJSON<Partial<PaymentSelection>>(
    PAYMENTS_SELECTION_STORAGE_KEY
  );

  return {
    provider: isPaymentProvider(storedSelection?.provider)
      ? storedSelection.provider
      : DEFAULT_PAYMENT_SELECTION.provider,
    environment: isPaymentEnvironment(storedSelection?.environment)
      ? storedSelection.environment
      : DEFAULT_PAYMENT_SELECTION.environment,
  };
}

export default function PaymentsLayout() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selection, setSelection] = useState<PaymentSelection>(() => readStoredPaymentSelection());

  useEffect(() => {
    setLocalStorageJSON(PAYMENTS_SELECTION_STORAGE_KEY, selection);
  }, [selection]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <PaymentsSidebar
        onOpenSettings={() => setIsSettingsOpen(true)}
        provider={selection.provider}
        setProvider={(provider: PaymentProvider) =>
          setSelection((current) => ({ ...current, provider }))
        }
        environment={selection.environment}
        setEnvironment={(environment: PaymentEnvironment) =>
          setSelection((current) => ({ ...current, environment }))
        }
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet
          context={{
            openPaymentsSettings: () => setIsSettingsOpen(true),
            provider: selection.provider,
            setProvider: (provider: PaymentProvider) =>
              setSelection((current) => ({ ...current, provider })),
            environment: selection.environment,
            setEnvironment: (environment: PaymentEnvironment) =>
              setSelection((current) => ({ ...current, environment })),
          }}
        />
      </div>
      <PaymentsSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        provider={selection.provider}
        setProvider={(provider: PaymentProvider) =>
          setSelection((current) => ({ ...current, provider }))
        }
      />
    </div>
  );
}
