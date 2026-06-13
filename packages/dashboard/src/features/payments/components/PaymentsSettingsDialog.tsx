import { useState } from 'react';
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
import type { PaymentsSettingsTab } from './PaymentsSettingsShared';

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

  const [activeTab, setActiveTab] = useState<PaymentsSettingsTab>('keys');

  // A pending mutation on either provider locks the whole dialog so a
  // provider switch mid-save can't fire conflicting actions.
  const isBusy = stripe.isPending || razorpay.isPending;
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
      setActiveTab('keys');
    }

    onOpenChange(nextOpen);
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
              onValueChange={setProvider}
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
              <MenuDialogNavItem
                icon={<RefreshCw className="h-5 w-5" />}
                active={activeTab === 'sync'}
                onClick={() => setActiveTab('sync')}
              >
                Sync
              </MenuDialogNavItem>
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
            ) : (
              <RazorpaySettingsPanel
                activeTab={activeTab}
                state={razorpay}
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
