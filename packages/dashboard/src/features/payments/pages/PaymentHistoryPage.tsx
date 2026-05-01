import { useMemo, useState } from 'react';
import { Settings } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { Button, Tab, Tabs } from '@insforge/ui';
import { ErrorState, LoadingState, TableHeader } from '../../../components';
import { cn } from '../../../lib/utils/utils';
import { usePaymentHistory } from '../hooks/usePaymentHistory';
import type { PaymentsOutletContext } from '../components/PaymentsLayout';
import type {
  PaymentHistory,
  PaymentHistoryStatus,
  PaymentHistoryType,
  StripeEnvironment,
} from '@insforge/shared-schemas';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

const PAYMENT_STATUS_CLASSES: Record<PaymentHistoryStatus, string> = {
  succeeded: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  refunded: 'bg-sky-50 text-sky-700 ring-sky-200',
  partially_refunded: 'bg-sky-50 text-sky-700 ring-sky-200',
};

const PAYMENT_TYPE_LABELS: Record<PaymentHistoryType, string> = {
  one_time_payment: 'One-time payment',
  subscription_invoice: 'Subscription invoice',
  refund: 'Refund',
  failed_payment: 'Failed payment',
};

function formatDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatStatusLabel(status: PaymentHistoryStatus) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatAmount(payment: PaymentHistory) {
  if (payment.amount === null || !payment.currency) {
    return '-';
  }

  const currency = payment.currency.toUpperCase();
  const fractionDigits =
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(payment.amount / 10 ** fractionDigits);
}

function formatRefundedAmount(payment: PaymentHistory) {
  if (!payment.amountRefunded || !payment.currency) {
    return null;
  }

  const currency = payment.currency.toUpperCase();
  const fractionDigits =
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(payment.amountRefunded / 10 ** fractionDigits);
}

function formatSubject(payment: PaymentHistory) {
  if (payment.subjectType && payment.subjectId) {
    return `${payment.subjectType}:${payment.subjectId}`;
  }

  return 'Unmapped';
}

function getEventDate(payment: PaymentHistory) {
  return (
    payment.paidAt ??
    payment.failedAt ??
    payment.refundedAt ??
    payment.stripeCreatedAt ??
    payment.createdAt
  );
}

function getPrimaryReference(payment: PaymentHistory) {
  return (
    payment.stripeRefundId ??
    payment.stripeInvoiceId ??
    payment.stripePaymentIntentId ??
    payment.stripeCheckoutSessionId ??
    payment.stripeChargeId ??
    payment.stripeSubscriptionId ??
    '-'
  );
}

function getReferenceSubtitle(payment: PaymentHistory) {
  return (
    payment.stripeProductId ??
    payment.stripePriceId ??
    payment.stripeSubscriptionId ??
    payment.stripeCheckoutSessionId ??
    null
  );
}

function getPaymentKey(payment: PaymentHistory) {
  return [
    payment.environment,
    payment.type,
    payment.stripeRefundId,
    payment.stripeInvoiceId,
    payment.stripePaymentIntentId,
    payment.stripeCheckoutSessionId,
    payment.stripeChargeId,
    payment.createdAt,
  ]
    .filter(Boolean)
    .join(':');
}

function PaymentStatus({ status }: { status: PaymentHistoryStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        PAYMENT_STATUS_CLASSES[status]
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

function ConfigureStripeKeyEmptyState({
  environment,
  onConfigure,
}: {
  environment: StripeEnvironment;
  onConfigure: () => void;
}) {
  const keyName = environment === 'test' ? 'STRIPE_TEST_SECRET_KEY' : 'STRIPE_LIVE_SECRET_KEY';

  return (
    <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--alpha-3)] text-muted-foreground">
          <Settings className="h-5 w-5" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground">
            Configure your Stripe {environment} key
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Add {keyName} before viewing {environment} payment history.
          </p>
        </div>
        <Button variant="secondary" onClick={onConfigure} className="mt-1 h-9 rounded px-3">
          <Settings className="h-4 w-4" />
          Configure Stripe API keys
        </Button>
      </div>
    </div>
  );
}

function PaymentHistoryTable({ payments }: { payments: PaymentHistory[] }) {
  if (payments.length === 0) {
    return (
      <div className="mx-auto flex w-4/5 max-w-[1120px] flex-col items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No payment history found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Checkout, invoice, and refund events will appear after Stripe webhooks are processed.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-4/5 max-w-[1120px] flex-col gap-1">
      {payments.map((payment) => {
        const refundedAmount = formatRefundedAmount(payment);
        const referenceSubtitle = getReferenceSubtitle(payment);

        return (
          <div
            key={getPaymentKey(payment)}
            className="rounded border border-[var(--alpha-8)] bg-card"
          >
            <div className="flex items-center rounded">
              <div className="flex h-14 min-w-0 flex-[1.25] flex-col justify-center px-2.5">
                <p className="truncate text-sm font-medium leading-[18px] text-foreground">
                  {PAYMENT_TYPE_LABELS[payment.type]}
                </p>
                <p className="truncate text-xs leading-4 text-muted-foreground">
                  {payment.description ?? payment.customerEmailSnapshot ?? '-'}
                </p>
              </div>

              <div className="flex h-14 w-[140px] shrink-0 items-center px-2.5">
                <PaymentStatus status={payment.status} />
              </div>

              <div className="flex h-14 w-[150px] shrink-0 flex-col justify-center px-2.5">
                <p className="text-sm font-medium leading-[18px] text-foreground">
                  {formatAmount(payment)}
                </p>
                {refundedAmount && (
                  <p className="truncate text-xs leading-4 text-muted-foreground">
                    Refunded {refundedAmount}
                  </p>
                )}
              </div>

              <div className="flex h-14 min-w-0 flex-1 flex-col justify-center px-2.5">
                <p className="truncate font-mono text-xs leading-[18px] text-foreground">
                  {formatSubject(payment)}
                </p>
                <p className="truncate font-mono text-xs leading-4 text-muted-foreground">
                  {payment.stripeCustomerId ?? payment.customerEmailSnapshot ?? '-'}
                </p>
              </div>

              <div className="flex h-14 min-w-0 flex-1 flex-col justify-center px-2.5">
                <p
                  className="truncate font-mono text-xs leading-[18px] text-foreground"
                  title={getPrimaryReference(payment)}
                >
                  {getPrimaryReference(payment)}
                </p>
                <p
                  className="truncate font-mono text-xs leading-4 text-muted-foreground"
                  title={referenceSubtitle ?? ''}
                >
                  {referenceSubtitle ?? '-'}
                </p>
              </div>

              <div className="flex h-14 w-[190px] shrink-0 items-center px-2.5">
                <span className="truncate text-sm leading-[18px] text-muted-foreground">
                  {formatDate(getEventDate(payment))}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PaymentHistoryPage() {
  const { openPaymentsSettings } = useOutletContext<PaymentsOutletContext>();
  const [environment, setEnvironment] = useState<StripeEnvironment>('test');
  const [searchQuery, setSearchQuery] = useState('');
  const { activeConnection, paymentHistory, isLoading, error, refetch } =
    usePaymentHistory(environment);

  const filteredPaymentHistory = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return paymentHistory;
    }

    return paymentHistory.filter((payment) =>
      [
        payment.type,
        payment.status,
        payment.subjectType,
        payment.subjectId,
        payment.stripeCustomerId,
        payment.customerEmailSnapshot,
        payment.stripeCheckoutSessionId,
        payment.stripePaymentIntentId,
        payment.stripeInvoiceId,
        payment.stripeChargeId,
        payment.stripeRefundId,
        payment.stripeSubscriptionId,
        payment.stripeProductId,
        payment.stripePriceId,
        payment.description,
        payment.currency,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch) ?? false)
    );
  }, [paymentHistory, searchQuery]);

  const hasActiveKey = !!activeConnection?.maskedKey;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Payment History"
        className="h-14 min-h-14"
        leftClassName="py-0"
        rightClassName="py-0"
        showDividerAfterTitle
        titleButtons={
          <Tabs
            value={environment}
            onValueChange={(value) => setEnvironment(value as StripeEnvironment)}
            className="h-8"
          >
            {ENVIRONMENTS.map((item) => (
              <Tab key={item} value={item} className="h-8 py-0">
                {item === 'test' ? 'Test' : 'Live'}
              </Tab>
            ))}
          </Tabs>
        }
        showSearch={hasActiveKey}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search payment history"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading Stripe payment history..." />
        ) : !hasActiveKey ? (
          <ConfigureStripeKeyEmptyState
            environment={environment}
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <>
            <div className="h-10" />

            <div className="sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3">
              <div className="mx-auto w-4/5 max-w-[1120px]">
                <div className="flex h-8 items-center text-sm text-muted-foreground">
                  <div className="flex-[1.25] px-2.5 py-1.5">Payment</div>
                  <div className="w-[140px] shrink-0 px-2.5 py-1.5">Status</div>
                  <div className="w-[150px] shrink-0 px-2.5 py-1.5">Amount</div>
                  <div className="flex-1 px-2.5 py-1.5">Customer</div>
                  <div className="flex-1 px-2.5 py-1.5">Reference</div>
                  <div className="w-[190px] shrink-0 px-2.5 py-1.5">Date</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 px-3 pb-4 pt-1">
              <PaymentHistoryTable payments={filteredPaymentHistory} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
