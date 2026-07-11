import { useState, type ReactNode } from 'react';
import { KeyRound, RefreshCw, Webhook } from 'lucide-react';
import {
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogDescription,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
} from '@insforge/ui';
import type { PaymentProvider } from '@insforge/shared-schemas';
import { PaymentProviderSelect, PAYMENT_PROVIDER_LABELS } from './PaymentProviderSelect';
import { StripeSettingsPanel, useStripeSettings } from './StripeSettingsPanel';
import { RazorpaySettingsPanel, useRazorpaySettings } from './RazorpaySettingsPanel';
import { PaystackSettingsPanel, usePaystackSettings } from './PaystackSettingsPanel';

export type PaymentsSettingsTab = 'keys' | 'webhooks' | 'sync';

interface PaymentsSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: PaymentProvider;
  setProvider: (provider: PaymentProvider) => void;
}

export function PaymentsSettingsDialog({
  open,
  onOpenChange,
  provider,
  setProvider,
}: PaymentsSettingsDialogProps) {
  const stripe = useStripeSettings(open);
  const razorpay = useRazorpaySettings(open);
  const paystack = usePaystackSettings(open);

  const [activeTab, setActiveTab] = useState<PaymentsSettingsTab>('keys');

  // A pending mutation on any provider locks the whole dialog so a
  // provider switch mid-save can't fire conflicting actions.
  const isBusy = stripe.isPending || razorpay.isPending || paystack.isPending;
  const canClose = !isBusy;
  const title =
    activeTab === 'keys' ? 'Connection Keys' : activeTab === 'webhooks' ? 'Webhooks' : 'Sync';
  const providerName = PAYMENT_PROVIDER_LABELS[provider];

  const handleOpenChange = (nextOpen: boolean) => {
    if (!canClose) {
      return;
    }

    if (!nextOpen) {
      stripe.reset();
      razorpay.reset();
      paystack.reset();
      setActiveTab('keys');
    }

    onOpenChange(nextOpen);
  };

  const handleProviderChange = (nextProvider: PaymentProvider) => {
    // Paystack has no sync flow, so its Sync tab is hidden; leave the
    // now-orphaned tab before switching.
    if (nextProvider === 'paystack' && activeTab === 'sync') {
      setActiveTab('keys');
    }
    setProvider(nextProvider);
  };

  return (
    <MenuDialog open={open} onOpenChange={handleOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>Payments Settings</MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <PaymentProviderSelect
              value={provider}
              onValueChange={handleProviderChange}
              triggerClassName="h-8 w-full rounded"
              contentClassName="w-[176px]"
            />
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<KeyRound className="h-5 w-5" />}
                active={activeTab === 'keys'}
                onClick={() => setActiveTab('keys')}
              >
                Connection Keys
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<Webhook className="h-5 w-5" />}
                active={activeTab === 'webhooks'}
                onClick={() => setActiveTab('webhooks')}
              >
                Webhooks
              </MenuDialogNavItem>
              {provider !== 'paystack' && (
                <MenuDialogNavItem
                  icon={<RefreshCw className="h-5 w-5" />}
                  active={activeTab === 'sync'}
                  onClick={() => setActiveTab('sync')}
                >
                  Sync
                </MenuDialogNavItem>
              )}
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{title}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {providerName} {title} settings
            </MenuDialogDescription>
            <div className="ml-auto" />
            <MenuDialogCloseButton className="shrink-0" />
          </MenuDialogHeader>

          <MenuDialogBody>
            {provider === 'stripe' ? (
              <StripeSettingsPanel activeTab={activeTab} state={stripe} isBusy={isBusy} />
            ) : provider === 'razorpay' ? (
              <RazorpaySettingsPanel
                activeTab={activeTab}
                state={razorpay}
                isBusy={isBusy}
                onGoToKeys={() => setActiveTab('keys')}
              />
            ) : (
              <PaystackSettingsPanel
                activeTab={activeTab}
                state={paystack}
                isBusy={isBusy}
                onGoToKeys={() => setActiveTab('keys')}
              />
            )}
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  children: ReactNode;
  orientation?: 'horizontal' | 'vertical';
}

export function SettingRow({
  label,
  description,
  children,
  orientation = 'horizontal',
}: SettingRowProps) {
  if (orientation === 'vertical') {
    return (
      <div className="flex w-full flex-col items-start gap-2">
        <div className="w-full shrink-0">
          <div className="py-1 flex items-center">
            <p className="text-sm font-medium leading-5 text-foreground">{label}</p>
          </div>
          {description && (
            <div className="pb-3 text-[13px] leading-[18px] text-muted-foreground">
              {description}
            </div>
          )}
        </div>
        <div className="min-w-0 w-full">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex w-full items-start gap-6">
      <div className="w-[200px] shrink-0">
        <div className="py-1.5">
          <p className="text-sm leading-5 text-foreground">{label}</p>
        </div>
        {description && (
          <div className="pb-2 pt-1 text-[13px] leading-[18px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function DialogSectionDivider() {
  return (
    <div className="flex h-5 items-center justify-center">
      <div className="h-px w-full bg-[var(--alpha-8)]" />
    </div>
  );
}
