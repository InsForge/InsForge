import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { PaymentCustomer } from '@insforge/shared-schemas';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@insforge/ui';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ErrorState,
  LoadingState,
  PaginationControls,
  TableHeader,
} from '#components';
import { PaymentsOnboardingState } from '#features/payments/components/PaymentsOnboardingState';
import type { PaymentsOutletContext } from '#features/payments/components/PaymentsLayout';
import { usePaymentCatalog } from '#features/payments/hooks/usePaymentCatalog';
import { usePaymentClientPagination } from '#features/payments/hooks/usePaymentClientPagination';
import { usePaymentCustomers } from '#features/payments/hooks/usePaymentCustomers';
import type { CatalogPrice, CatalogProduct } from '#features/payments/types/catalog';
import { usePaymentSubscriptions } from '#features/payments/hooks/usePaymentSubscriptions';
import type {
  PaymentSubscription,
  PaymentSubscriptionItem,
  PaymentSubscriptionStatus,
} from '#features/payments/types/subscriptions';

type SubscriptionDisplayStatus = PaymentSubscriptionStatus | 'cancelling';

const SUBSCRIPTION_STATUS_CLASSES: Record<SubscriptionDisplayStatus, string> = {
  incomplete: 'bg-[var(--alpha-8)] text-amber-400',
  incomplete_expired: 'bg-[var(--alpha-8)] text-muted-foreground',
  trialing: 'bg-[var(--alpha-8)] text-sky-400',
  active: 'bg-[var(--alpha-8)] text-emerald-400',
  past_due: 'bg-[var(--alpha-8)] text-amber-400',
  canceled: 'bg-[var(--alpha-8)] text-muted-foreground',
  unpaid: 'bg-[var(--alpha-8)] text-rose-400',
  paused: 'bg-[var(--alpha-8)] text-muted-foreground',
  cancelling: 'bg-[var(--alpha-8)] text-amber-400',
};

const SUBSCRIPTION_ROW_GRID_TEMPLATE =
  '32px minmax(0, 1.3fr) minmax(0, 1fr) 100px minmax(0, 1.2fr) minmax(0, 0.75fr)';

const SUBSCRIPTION_ITEM_GRID_TEMPLATE = 'minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) 100px';

function formatDate(value: string | null) {
  if (!value) {
    return '-';
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

function formatLastSynced(value: string | null) {
  return value ? formatDate(value) : 'Never';
}

function formatShortDate(value: string | null) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatStatusLabel(status: PaymentSubscriptionStatus) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getSubscriptionStatusDisplay(subscription: PaymentSubscription) {
  const isCancelling = subscription.status !== 'canceled' && !!subscription.cancelAt;

  if (isCancelling) {
    return {
      label: 'Cancelling',
      className: SUBSCRIPTION_STATUS_CLASSES.cancelling,
      tooltip: `Cancels on ${formatDate(subscription.cancelAt)}`,
    };
  }

  if (subscription.status === 'canceled') {
    const canceledAt = subscription.canceledAt ?? subscription.cancelAt;

    return {
      label: formatStatusLabel(subscription.status),
      className: SUBSCRIPTION_STATUS_CLASSES[subscription.status],
      tooltip: canceledAt ? `Canceled on ${formatDate(canceledAt)}` : null,
    };
  }

  return {
    label: formatStatusLabel(subscription.status),
    className: SUBSCRIPTION_STATUS_CLASSES[subscription.status],
    tooltip: null,
  };
}

function formatPeriod(subscription: PaymentSubscription) {
  if (!subscription.currentPeriodStart && !subscription.currentPeriodEnd) {
    return 'No active period';
  }

  return `${formatShortDate(subscription.currentPeriodStart)} - ${formatShortDate(
    subscription.currentPeriodEnd
  )}`;
}

function getCurrencyFractionDigits(currency: string) {
  return (
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
      currencyDisplay: 'code',
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function formatPriceAmount(price: CatalogPrice) {
  const rawAmount =
    price.unitAmount ?? (price.unitAmountDecimal ? Number(price.unitAmountDecimal) : null);

  if (rawAmount === null || Number.isNaN(rawAmount)) {
    return 'Custom';
  }

  const currency = price.currency.toUpperCase();
  const fractionDigits = getCurrencyFractionDigits(currency);

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
  }).format(rawAmount / 10 ** fractionDigits);
}

function getCustomerLabel(customer: PaymentCustomer | null, subscription: PaymentSubscription) {
  return customer?.email ?? customer?.name ?? subscription.providerCustomerId ?? 'Unknown Customer';
}

function getSubscriptionItemProductLabel(
  item: PaymentSubscriptionItem,
  product: CatalogProduct | null
) {
  return product?.name ?? item.providerProductId ?? '-';
}

function getSubscriptionItemPriceLabel(item: PaymentSubscriptionItem, price: CatalogPrice | null) {
  return price ? formatPriceAmount(price) : (item.providerPriceId ?? '-');
}

function SubscriptionStatus({ subscription }: { subscription: PaymentSubscription }) {
  const display = getSubscriptionStatusDisplay(subscription);
  const badge = (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        display.className
      )}
    >
      {display.label}
    </span>
  );

  if (!display.tooltip) {
    return badge;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" align="center">
          {display.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function EmptySubscriptionsState({ hasSearchQuery }: { hasSearchQuery: boolean }) {
  return (
    <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasSearchQuery ? 'No subscriptions match your search' : 'No subscriptions found'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasSearchQuery
          ? 'Try a different subscription, customer, invoice, or product reference.'
          : 'Completed subscription checkouts will appear after provider webhooks are processed.'}
      </p>
    </div>
  );
}

function SubscriptionItemsTable({
  items,
  productsById,
  pricesById,
}: {
  items: PaymentSubscriptionItem[];
  productsById: Map<string, CatalogProduct>;
  pricesById: Map<string, CatalogPrice>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No subscription items found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Provider items will appear after the subscription webhook projection is updated.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div
        className="grid border-b border-[var(--alpha-8)] bg-alpha-4 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: SUBSCRIPTION_ITEM_GRID_TEMPLATE }}
      >
        <div>Item</div>
        <div>Product</div>
        <div>Price</div>
        <div>Quantity</div>
      </div>

      {items.map((item) => {
        const product = item.providerProductId
          ? (productsById.get(item.providerProductId) ?? null)
          : null;
        const price = item.providerPriceId ? (pricesById.get(item.providerPriceId) ?? null) : null;

        return (
          <div
            key={`${item.environment}:${item.providerSubscriptionItemId}`}
            className="grid items-center border-b border-[var(--alpha-8)] px-4 py-3 text-sm last:border-0"
            style={{ gridTemplateColumns: SUBSCRIPTION_ITEM_GRID_TEMPLATE }}
          >
            <div className="min-w-0">
              <p
                className="truncate font-mono text-xs text-foreground"
                title={item.providerSubscriptionItemId}
              >
                {item.providerSubscriptionItemId}
              </p>
            </div>

            <div className="min-w-0">
              <p
                className="truncate text-foreground"
                title={product?.providerProductId ?? item.providerProductId ?? undefined}
              >
                {getSubscriptionItemProductLabel(item, product)}
              </p>
            </div>

            <div className="min-w-0">
              <p
                className="truncate text-foreground"
                title={price?.providerPriceId ?? item.providerPriceId ?? undefined}
              >
                {getSubscriptionItemPriceLabel(item, price)}
              </p>
            </div>

            <div className="min-w-0 truncate text-foreground">{item.quantity ?? '-'}</div>
          </div>
        );
      })}
    </div>
  );
}

function SubscriptionRow({
  subscription,
  customer,
  productsById,
  pricesById,
  expanded,
  onToggle,
}: {
  subscription: PaymentSubscription;
  customer: PaymentCustomer | null;
  productsById: Map<string, CatalogProduct>;
  pricesById: Map<string, CatalogPrice>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const items = subscription.items ?? [];
  const detailsId = `subscription-details-${subscription.providerSubscriptionId}`;

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailsId}
        className="w-full text-left transition-colors hover:bg-alpha-4"
      >
        <div
          className="grid min-h-12 items-center gap-0 px-2 text-sm"
          style={{ gridTemplateColumns: SUBSCRIPTION_ROW_GRID_TEMPLATE }}
        >
          <div className="flex items-center justify-center text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>

          <div className="min-w-0 px-2 py-3">
            <span
              className="block truncate font-mono text-xs text-foreground"
              title={subscription.providerSubscriptionId}
            >
              {subscription.providerSubscriptionId}
            </span>
          </div>

          <div className="min-w-0 px-2 py-3">
            <span
              className="block truncate text-foreground"
              title={getCustomerLabel(customer, subscription)}
            >
              {getCustomerLabel(customer, subscription)}
            </span>
          </div>

          <div className="px-2 py-3">
            <SubscriptionStatus subscription={subscription} />
          </div>

          <div className="min-w-0 px-2 py-3">
            <span className="truncate text-foreground">{formatPeriod(subscription)}</span>
          </div>

          <div className="min-w-0 px-2 py-3">
            {subscription.providerLatestInvoiceId ? (
              <span
                className="block truncate font-mono text-xs text-foreground"
                title={subscription.providerLatestInvoiceId}
              >
                {subscription.providerLatestInvoiceId}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div id={detailsId} className="border-t border-[var(--alpha-8)] pb-3 pl-[30px] pr-3 pt-0">
          <div className="bg-[rgb(var(--semantic-1))] px-4 py-4">
            <div className="flex flex-col gap-2">
              <div>
                <h2 className="text-base font-medium text-foreground">Subscription Items</h2>
                <p className="text-sm text-muted-foreground">
                  Items associated with this subscription, including product and price links.
                </p>
              </div>
              <SubscriptionItemsTable
                items={items}
                productsById={productsById}
                pricesById={pricesById}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionsPage() {
  const { openPaymentsSettings, provider, setProvider, environment } =
    useOutletContext<PaymentsOutletContext>();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);

  const {
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    subscriptions,
    isLoading,
    error,
    refetch,
  } = usePaymentSubscriptions(provider, environment);
  const { customers } = usePaymentCustomers(provider, environment);
  const { products, prices } = usePaymentCatalog(provider, environment);

  useEffect(() => {
    setExpandedSubscriptionId(null);
  }, [environment, provider]);

  const customersById = useMemo(() => {
    const nextCustomersById = new Map<string, PaymentCustomer>();
    for (const customer of customers) {
      nextCustomersById.set(customer.providerCustomerId, customer);
    }

    return nextCustomersById;
  }, [customers]);

  const productsById = useMemo(() => {
    const nextProductsById = new Map<string, CatalogProduct>();
    for (const product of products) {
      nextProductsById.set(product.providerProductId, product);
    }

    return nextProductsById;
  }, [products]);

  const pricesById = useMemo(() => {
    const nextPricesById = new Map<string, CatalogPrice>();
    for (const price of prices) {
      nextPricesById.set(price.providerPriceId, price);
    }

    return nextPricesById;
  }, [prices]);

  const filteredSubscriptions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return subscriptions;
    }

    return subscriptions.filter((subscription) => {
      const customer = subscription.providerCustomerId
        ? (customersById.get(subscription.providerCustomerId) ?? null)
        : null;
      const itemValues = (subscription.items ?? []).flatMap((item) => {
        const product = item.providerProductId
          ? (productsById.get(item.providerProductId) ?? null)
          : null;
        const price = item.providerPriceId ? (pricesById.get(item.providerPriceId) ?? null) : null;

        return [
          item.providerSubscriptionItemId,
          item.providerProductId,
          item.providerPriceId,
          product?.name,
          price ? formatPriceAmount(price) : null,
        ];
      });

      const statusDisplay = getSubscriptionStatusDisplay(subscription);

      return [
        subscription.providerSubscriptionId,
        subscription.providerCustomerId,
        customer?.email,
        customer?.name,
        subscription.status,
        statusDisplay.label,
        statusDisplay.tooltip,
        subscription.providerLatestInvoiceId,
        formatPeriod(subscription),
        ...itemValues,
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [customersById, pricesById, productsById, searchQuery, subscriptions]);

  useEffect(() => {
    if (
      expandedSubscriptionId &&
      !filteredSubscriptions.some(
        (subscription) => subscription.providerSubscriptionId === expandedSubscriptionId
      )
    ) {
      setExpandedSubscriptionId(null);
    }
  }, [expandedSubscriptionId, filteredSubscriptions]);

  const {
    currentPage,
    setCurrentPage,
    totalPages,
    pageSize,
    startIndex,
    endIndex,
    showPagination,
  } = usePaymentClientPagination(filteredSubscriptions.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [environment, provider, searchQuery, setCurrentPage]);

  const paginatedSubscriptions = useMemo(
    () => filteredSubscriptions.slice(startIndex, endIndex),
    [endIndex, filteredSubscriptions, startIndex]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      {hasActiveKey && (
        <TableHeader
          className="h-14 min-h-14"
          leftClassName="py-0"
          rightClassName="py-0"
          title="Subscriptions"
          showDividerAfterTitle
          leftSlot={
            <span className="text-xs text-muted-foreground">
              Last synced:{' '}
              {formatLastSynced(
                activeConnection?.lastSyncedAt ?? activeRazorpayConnection?.lastSyncedAt ?? null
              )}
            </span>
          }
          showSearch
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchDebounceTime={300}
          searchPlaceholder="Search subscription"
          searchInputClassName="w-[280px]"
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading subscriptions..." />
        ) : !hasActiveKey ? (
          <PaymentsOnboardingState
            provider={provider}
            environment={environment}
            onConfigure={openPaymentsSettings}
            onProviderChange={setProvider}
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
                  style={{ gridTemplateColumns: SUBSCRIPTION_ROW_GRID_TEMPLATE }}
                >
                  <div />
                  <div className="px-2 py-1.5">Subscription</div>
                  <div className="px-2 py-1.5">Customer</div>
                  <div className="px-2 py-1.5">Status</div>
                  <div className="px-2 py-1.5">Current Period</div>
                  <div className="px-2 py-1.5">Latest Invoice</div>
                </div>

                {filteredSubscriptions.length === 0 ? (
                  <EmptySubscriptionsState hasSearchQuery={searchQuery.trim().length > 0} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {paginatedSubscriptions.map((subscription) => (
                      <SubscriptionRow
                        key={`${subscription.environment}:${subscription.providerSubscriptionId}`}
                        subscription={subscription}
                        customer={
                          subscription.providerCustomerId
                            ? (customersById.get(subscription.providerCustomerId) ?? null)
                            : null
                        }
                        productsById={productsById}
                        pricesById={pricesById}
                        expanded={expandedSubscriptionId === subscription.providerSubscriptionId}
                        onToggle={() =>
                          setExpandedSubscriptionId((current) =>
                            current === subscription.providerSubscriptionId
                              ? null
                              : subscription.providerSubscriptionId
                          )
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {showPagination && (
              <div className="border-t border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
                <PaginationControls
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  totalRecords={filteredSubscriptions.length}
                  pageSize={pageSize}
                  recordLabel="subscriptions"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
