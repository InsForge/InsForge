import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from '@insforge/ui';
import type { PaymentEnvironment, PaymentProvider } from '@insforge/shared-schemas';
import RazorpayWordmark from '#assets/logos/razorpay-wordmark.svg?react';
import StripeWordmark from '#assets/logos/stripe-wordmark.svg?react';

interface QuickGuideStep {
  title: string;
  description: string;
}

const PAYMENT_QUICK_GUIDES: Record<
  PaymentProvider,
  Record<PaymentEnvironment, QuickGuideStep[]>
> = {
  stripe: {
    test: [
      {
        title: 'Go to Stripe',
        description: 'Log in to the Stripe Dashboard.',
      },
      {
        title: "Make sure you're in test/sandbox mode",
        description: 'Turn on View test data, or choose the Sandbox that should own this key.',
      },
      {
        title: 'Go to Developers -> API keys',
        description: 'Under Standard keys, copy a secret key that starts with sk_test_.',
      },
      {
        title: 'Come back here',
        description: 'Click the button below to open Payments Settings, then paste the secret key.',
      },
    ],
    live: [
      {
        title: 'Go to Stripe',
        description: 'Log in to the Stripe Dashboard.',
      },
      {
        title: 'Make sure live mode is selected',
        description: 'Use the live account or mode that should process production payments.',
      },
      {
        title: 'Go to Developers -> API keys',
        description: 'Under Standard keys, copy an sk_live_ key. New secret keys are shown once.',
      },
      {
        title: 'Come back here',
        description: 'Click the button below to open Payments Settings, then paste the secret key.',
      },
    ],
  },
  razorpay: {
    test: [
      {
        title: 'Go to Razorpay',
        description: 'Log in to the Razorpay Dashboard.',
      },
      {
        title: 'Switch to Test Mode',
        description: 'Use the Test Mode toggle before generating test API keys.',
      },
      {
        title: 'Go to Account & Settings -> API Keys',
        description: 'Under Website and app settings, click Generate Key and save both values.',
      },
      {
        title: 'Come back here',
        description:
          'Click the button below to open Payments Settings, then paste the Key ID and Key Secret.',
      },
    ],
    live: [
      {
        title: 'Go to Razorpay',
        description: 'Log in to the Razorpay Dashboard.',
      },
      {
        title: 'Switch to Live Mode',
        description:
          'Use the Live Mode toggle. If keys are unavailable, add website details first.',
      },
      {
        title: 'Go to Account & Settings -> API Keys',
        description: 'Under Website and app settings, generate the keys and save both values.',
      },
      {
        title: 'Come back here',
        description:
          'Click the button below to open Payments Settings, then paste the Key ID and Key Secret.',
      },
    ],
  },
  paystack: {
    test: [
      {
        title: 'Go to Paystack',
        description: 'Log in to the Paystack Dashboard.',
      },
      {
        title: 'Switch to Test Mode',
        description: 'Use the mode toggle so the keys shown are test keys.',
      },
      {
        title: 'Go to Settings -> API Keys & Webhooks',
        description: 'Copy the secret key that starts with sk_test_.',
      },
      {
        title: 'Come back here',
        description: 'Click the button below to open Payments Settings, then paste the Secret Key.',
      },
    ],
    live: [
      {
        title: 'Go to Paystack',
        description: 'Log in to the Paystack Dashboard.',
      },
      {
        title: 'Switch to Live Mode',
        description: 'If live keys are unavailable, complete business activation first.',
      },
      {
        title: 'Go to Settings -> API Keys & Webhooks',
        description: 'Copy the secret key that starts with sk_live_.',
      },
      {
        title: 'Come back here',
        description: 'Click the button below to open Payments Settings, then paste the Secret Key.',
      },
    ],
  },
};

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: 'Stripe',
  razorpay: 'Razorpay',
  paystack: 'Paystack',
};

interface PaymentsOnboardingStateProps {
  provider: PaymentProvider;
  environment: PaymentEnvironment;
  onConfigure: () => void;
  onProviderChange?: (provider: PaymentProvider) => void;
}

type WordmarkTone = 'muted' | 'color';
type WordmarkPlacement = 'guide' | 'switcher';

const WORDMARK_SIZE_CLASSES: Record<PaymentProvider, Record<WordmarkPlacement, string>> = {
  stripe: {
    guide: 'w-24',
    switcher: 'w-14',
  },
  razorpay: {
    guide: 'w-32',
    switcher: 'w-16',
  },
  paystack: {
    guide: 'w-32',
    switcher: 'w-16',
  },
};

function PaymentProviderWordmark({
  provider,
  tone,
  placement,
}: {
  provider: PaymentProvider;
  tone: WordmarkTone;
  placement: WordmarkPlacement;
}) {
  const label = PROVIDER_LABELS[provider];
  const sizeClassName = WORDMARK_SIZE_CLASSES[provider][placement];
  const mutedClassName = 'text-[#525252] [&_path]:fill-current [&_polygon]:fill-current';

  if (provider === 'stripe') {
    return (
      <StripeWordmark
        role="img"
        aria-label={label}
        className={cn(
          'block h-auto',
          sizeClassName,
          tone === 'muted' ? 'text-[#525252]' : 'text-[#635BFF]'
        )}
      />
    );
  }

  // Paystack has no wordmark asset yet, so render a styled text placeholder.
  if (provider === 'paystack') {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn(
          'block text-center font-semibold leading-none',
          placement === 'guide' ? 'text-2xl' : 'text-base',
          sizeClassName,
          tone === 'muted' ? 'text-[#525252]' : 'text-[#09A5DB]'
        )}
      >
        Paystack
      </span>
    );
  }

  return (
    <RazorpayWordmark
      role="img"
      aria-label={label}
      className={cn('block h-auto', sizeClassName, tone === 'muted' ? mutedClassName : undefined)}
    />
  );
}

function PaymentProviderCard({
  provider,
  onClick,
}: {
  provider: PaymentProvider;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-10 w-20 items-center justify-center rounded bg-white px-2 py-1 transition-opacity hover:opacity-90"
      onClick={onClick}
    >
      <PaymentProviderWordmark provider={provider} tone="color" placement="switcher" />
    </button>
  );
}

function QuickGuideStepItem({
  step,
  index,
  isLast,
}: {
  step: QuickGuideStep;
  index: number;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-2">
      <div className="flex shrink-0 flex-col items-center pt-0.5">
        <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-alpha-8 px-1.5 text-xs font-medium leading-4 text-foreground">
          {index + 1}
        </div>
        {!isLast && <div className="mt-0.5 w-px flex-1 bg-alpha-8" />}
      </div>
      <div className={isLast ? 'min-w-0 flex-1 text-left' : 'min-w-0 flex-1 pb-6 text-left'}>
        <p className="text-sm font-medium leading-6 text-foreground">{step.title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
      </div>
    </div>
  );
}

export function PaymentsOnboardingState({
  provider,
  environment,
  onConfigure,
  onProviderChange,
}: PaymentsOnboardingStateProps) {
  const { t } = useTranslation('chrome');
  const providerLabel = PROVIDER_LABELS[provider];
  const modeLabel =
    environment === 'test'
      ? t('payments.modeTest', { defaultValue: 'Test' })
      : t('payments.modeLive', { defaultValue: 'Live' });
  const onboardingTitle =
    provider === 'stripe'
      ? t('payments.onboardingTitleSingleKey', {
          defaultValue: 'Configure Your {{provider}} {{mode}} Key',
          provider: providerLabel,
          mode: modeLabel,
        })
      : t('payments.onboardingTitleMultipleKeys', {
          defaultValue: 'Configure Your {{provider}} {{mode}} Keys',
          provider: providerLabel,
          mode: modeLabel,
        });
  const quickGuideSteps = PAYMENT_QUICK_GUIDES[provider][environment].map((step, index) => ({
    title: t(`payments.quickGuide.${provider}.${environment}.step${index + 1}Title`, {
      defaultValue: step.title,
    }),
    description: t(`payments.quickGuide.${provider}.${environment}.step${index + 1}Description`, {
      defaultValue: step.description,
    }),
  }));
  const alternativeProvider: PaymentProvider = provider === 'stripe' ? 'razorpay' : 'stripe';

  return (
    <div className="flex h-full min-h-[560px] items-start justify-center overflow-y-auto px-6 py-20">
      <div className="flex w-full max-w-[520px] flex-col items-center gap-6 text-center">
        <div className="flex h-10 items-center justify-center">
          <PaymentProviderWordmark provider={provider} tone="muted" placement="guide" />
        </div>

        <div className="flex w-full flex-col items-center gap-4">
          <h2 className="text-xl font-medium leading-7 text-foreground">{onboardingTitle}</h2>
        </div>

        <div className="w-full rounded-lg border border-[var(--alpha-8)] bg-card px-6 pb-8 pt-6">
          {quickGuideSteps.map((step, index) => (
            <QuickGuideStepItem
              key={step.title}
              step={step}
              index={index}
              isLast={index === quickGuideSteps.length - 1}
            />
          ))}
          <div className="mt-4 pl-7 text-left">
            <Button
              variant="outline"
              size="default"
              onClick={onConfigure}
              className="h-8 rounded px-2.5"
            >
              <Settings className="h-4 w-4" />
              {t('payments.configureApiKeys', {
                defaultValue: 'Configure {{provider}} API keys',
                provider: providerLabel,
              })}
            </Button>
          </div>
        </div>

        {onProviderChange ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-xs leading-4 text-muted-foreground">
              {t('payments.orChangeProvider', { defaultValue: 'or change a payment provider' })}
            </p>
            <PaymentProviderCard
              provider={alternativeProvider}
              onClick={() => onProviderChange(alternativeProvider)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
