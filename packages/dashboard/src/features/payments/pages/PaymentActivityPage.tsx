import { useCallback, useMemo, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type {
  PaymentActivity,
  PaymentActivityStatus,
  PaymentActivityType,
} from '@insforge/shared-schemas';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ErrorState,
  LoadingState,
  PaginationControls,
  TableHeader,
} from '#components';
import { PaymentsKeyMissingState } from '#features/payments/components/PaymentsKeyMissingState';
import { ProviderBadge } from '#features/payments/components/ProviderBadge';
import type { PaymentsOutletContext } from '#features/payments/components/PaymentsLayout';
import { usePaymentActivity } from '#features/payments/hooks/usePaymentActivity';
import { cn } from '#lib/utils/utils';

const PAYMENT_HISTORY_GRID_TEMPLATE =
  'minmax(0,1.45fr) 120px 100px minmax(0,1.1fr) 120px minmax(0,1fr) 180px';

const PAYMENT_STATUS_CLASS_NAMES: Record<PaymentActivityStatus, string> = {
  succeeded: 'bg-[var(--alpha-8)] text-emerald-400',
  failed: 'bg-[var(--alpha-8)] text-rose-400',
  pending: 'bg-[var(--alpha-8)] text-amber-400',
  refunded: 'bg-[var(--alpha-8)] text-sky-400',
  partially_refunded: 'bg-[var(--alpha-8)] text-sky-400',
};

const PAYMENT_TYPE_LABELS: Record<PaymentActivityType, string> = {
  one_time_payment: 'One-Time Payment',
  subscription_invoice: 'Subscription Invoice',
  refund: 'Refund',
  failed_payment: 'Failed Payment',
};

function formatAmountValue(amount: number | null, currency: string | null) {
  if (amount === null || !currency) {
    return '-';
  }

  const normalizedCurrency = currency.toUpperCase();
  const fractionDigits =
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: normalizedCurrency,
    currencyDisplay: 'code',
  }).format(amount / 10 ** fractionDigits);
}

function formatEventDate(value: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getEventDate(payment: PaymentActivity) {
  return (
    payment.paidAt ??
    payment.failedAt ??
    payment.refundedAt ??
    payment.providerCreatedAt ??
    payment.createdAt
  );
}

function formatProviderReferenceType(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getProviderReferenceId(payment: PaymentActivity) {
  return payment.providerReferenceId ?? '-';
}

function getProviderReferenceTitle(payment: PaymentActivity) {
  const referenceId = getProviderReferenceId(payment);
  if (referenceId === '-') {
    return undefined;
  }

  const referenceType = formatProviderReferenceType(payment.providerReferenceType);
  return referenceType ? `${referenceType}: ${referenceId}` : referenceId;
}

function getPaymentKey(payment: PaymentActivity) {
  return [
    payment.environment,
    payment.type,
    payment.providerReferenceType,
    payment.providerReferenceId,
    payment.createdAt,
  ]
    .filter(Boolean)
    .join(':');
}

function getCustomerLabel(payment: PaymentActivity) {
  return (
    payment.customerEmailSnapshot ??
    payment.providerCustomerId ??
    (payment.subjectType && payment.subjectId
      ? `${payment.subjectType}:${payment.subjectId}`
      : 'Guest')
  );
}

function isMutedCustomer(payment: PaymentActivity) {
  return !payment.customerEmailSnapshot;
}

function formatStatusLabel(status: PaymentActivityStatus) {
  if (status === 'pending') {
    return 'Delayed';
  }

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function PaymentStatusBadge({ status }: { status: PaymentActivityStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        PAYMENT_STATUS_CLASS_NAMES[status]
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

function getPaymentProvider(payment: PaymentActivity) {
  return payment.provider === 'razorpay' ? 'Razorpay' : 'Stripe';
}

function EmptyPaymentActivityState({ hasSearchQuery }: { hasSearchQuery: boolean }) {
  return (
    <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasSearchQuery ? 'No payments match your search' : 'No payment activity found'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasSearchQuery
          ? 'Try a different payment type, customer, payment intent, or invoice reference.'
          : 'Checkout, invoice, and refund events will appear here after payment activity is recorded.'}
      </p>
    </div>
  );
}

function PaymentActivityRow({ payment }: { payment: PaymentActivity }) {
  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div
        className="grid min-h-12 items-center gap-0 px-2 text-sm transition-colors hover:bg-alpha-4"
        style={{ gridTemplateColumns: PAYMENT_HISTORY_GRID_TEMPLATE }}
      >
        <div className="min-w-0 px-2 py-3">
          <span className="block truncate text-foreground">
            {PAYMENT_TYPE_LABELS[payment.type]}
          </span>
        </div>

        <div className="px-2 py-3">
          <PaymentStatusBadge status={payment.status} />
        </div>

        <div className="px-2 py-3">
          <ProviderBadge provider={getPaymentProvider(payment)} />
        </div>

        <div className="min-w-0 px-2 py-3">
          <span
            className={cn(
              'block truncate text-[13px] leading-[18px]',
              isMutedCustomer(payment) ? 'text-muted-foreground' : 'text-foreground'
            )}
            title={getCustomerLabel(payment)}
          >
            {getCustomerLabel(payment)}
          </span>
        </div>

        <div className="min-w-0 px-2 py-3">
          <span className="block truncate text-foreground">
            {formatAmountValue(payment.amount, payment.currency)}
          </span>
        </div>

        <div className="min-w-0 px-2 py-3">
          <span
            className={cn(
              'block truncate text-[13px] leading-[18px]',
              getProviderReferenceId(payment) === '-' ? 'text-muted-foreground' : 'text-foreground'
            )}
            title={getProviderReferenceTitle(payment)}
          >
            {getProviderReferenceId(payment)}
          </span>
        </div>

        <div className="min-w-0 px-2 py-3">
          <span className="block truncate text-foreground">
            {formatEventDate(getEventDate(payment))}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PaymentActivityPage() {
  const { openPaymentsSettings, environment } = useOutletContext<PaymentsOutletContext>();
  const [searchQuery, setSearchQuery] = useState('');
  const {
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    paymentActivity,
    isLoading,
    error,
    refetch,
  } = usePaymentActivity(environment);

  const filteredPaymentActivity = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return paymentActivity;
    }

    return paymentActivity.filter((payment) =>
      [
        PAYMENT_TYPE_LABELS[payment.type],
        payment.status,
        payment.subjectType,
        payment.subjectId,
        payment.providerCustomerId,
        payment.customerEmailSnapshot,
        payment.providerReferenceId,
        payment.providerReferenceType,
        payment.description,
        payment.currency,
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .some((value) => value.toLowerCase().includes(normalizedSearch))
    );
  }, [paymentActivity, searchQuery]);

  const handlePageChange = useCallback((_page: number) => {}, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Payment Activity"
        className="h-14 min-h-14"
        leftClassName="py-0"
        rightClassName="py-0"
        showSearch={hasActiveKey}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search payment"
        searchInputClassName="w-[280px]"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading payment activity..." />
        ) : !hasActiveKey ? (
          <PaymentsKeyMissingState
            environment={environment}
            resourceLabel="payment activity"
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              <div className="flex flex-col gap-3">
                {activeConnection?.lastSyncError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Latest Stripe sync failed</AlertTitle>
                    <AlertDescription className="mt-2">
                      {activeConnection.lastSyncError}
                    </AlertDescription>
                  </Alert>
                )}
                {activeRazorpayConnection?.lastSyncError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Latest Razorpay sync failed</AlertTitle>
                    <AlertDescription className="mt-2">
                      {activeRazorpayConnection.lastSyncError}
                    </AlertDescription>
                  </Alert>
                )}

                <div
                  className="grid gap-0 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  style={{ gridTemplateColumns: PAYMENT_HISTORY_GRID_TEMPLATE }}
                >
                  <div className="px-2 py-1.5">Payment</div>
                  <div className="px-2 py-1.5">Status</div>
                  <div className="px-2 py-1.5">Provider</div>
                  <div className="px-2 py-1.5">Customer</div>
                  <div className="px-2 py-1.5">Amount</div>
                  <div className="px-2 py-1.5">Provider ID</div>
                  <div className="px-2 py-1.5">Date</div>
                </div>

                {filteredPaymentActivity.length === 0 ? (
                  <EmptyPaymentActivityState hasSearchQuery={searchQuery.trim().length > 0} />
                ) : (
                  <div className="flex flex-col gap-1">
                    {filteredPaymentActivity.map((payment) => (
                      <PaymentActivityRow key={getPaymentKey(payment)} payment={payment} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
              <PaginationControls
                currentPage={1}
                totalPages={1}
                onPageChange={handlePageChange}
                totalRecords={filteredPaymentActivity.length}
                pageSize={Math.max(filteredPaymentActivity.length, 1)}
                recordLabel="payments"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
