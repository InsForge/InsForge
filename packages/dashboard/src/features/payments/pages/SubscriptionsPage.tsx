import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type {
  StripeCustomer,
  StripePrice,
  StripeProduct,
  StripeSubscriptionItem,
  StripeSubscription,
  StripeSubscriptionStatus,
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
import type { PaymentsOutletContext } from '#features/payments/components/PaymentsLayout';
import { usePaymentCatalog } from '#features/payments/hooks/usePaymentCatalog';
import { usePaymentCustomers } from '#features/payments/hooks/usePaymentCustomers';
import { usePaymentSubscriptions } from '#features/payments/hooks/usePaymentSubscriptions';
import { cn } from '#lib/utils/utils';

const SUBSCRIPTION_STATUS_CLASSES: Record<StripeSubscriptionStatus, string> = {
  incomplete: 'bg-[var(--alpha-8)] text-amber-400',
  incomplete_expired: 'bg-[var(--alpha-8)] text-muted-foreground',
  trialing: 'bg-[var(--alpha-8)] text-sky-400',
  active: 'bg-[var(--alpha-8)] text-emerald-400',
  past_due: 'bg-[var(--alpha-8)] text-amber-400',
  canceled: 'bg-[var(--alpha-8)] text-muted-foreground',
  unpaid: 'bg-[var(--alpha-8)] text-rose-400',
  paused: 'bg-[var(--alpha-8)] text-muted-foreground',
};

const SUBSCRIPTION_ROW_GRID_TEMPLATE =
  '32px minmax(0, 1.3fr) minmax(0, 1fr) 120px minmax(0, 1.2fr) minmax(0, 0.75fr)';

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

function formatStatusLabel(status: StripeSubscriptionStatus) {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPeriod(subscription: StripeSubscription) {
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

function formatPriceAmount(price: StripePrice) {
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

function getCustomerLabel(customer: StripeCustomer | null, subscription: StripeSubscription) {
  return customer?.email ?? customer?.name ?? subscription.stripeCustomerId;
}

function getSubscriptionItemProductLabel(
  item: StripeSubscriptionItem,
  product: StripeProduct | null
) {
  return product?.name ?? item.stripeProductId ?? '-';
}

function getSubscriptionItemPriceLabel(item: StripeSubscriptionItem, price: StripePrice | null) {
  return price ? formatPriceAmount(price) : (item.stripePriceId ?? '-');
}

function SubscriptionStatus({ status }: { status: StripeSubscriptionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        SUBSCRIPTION_STATUS_CLASSES[status]
      )}
    >
      {formatStatusLabel(status)}
    </span>
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
          : 'Completed subscription checkouts will appear after Stripe webhooks are processed.'}
      </p>
    </div>
  );
}

function SubscriptionItemsTable({
  items,
  productsById,
  pricesById,
}: {
  items: StripeSubscriptionItem[];
  productsById: Map<string, StripeProduct>;
  pricesById: Map<string, StripePrice>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No subscription items found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Stripe items will appear after the subscription webhook projection is updated.
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
        const product = item.stripeProductId
          ? (productsById.get(item.stripeProductId) ?? null)
          : null;
        const price = item.stripePriceId ? (pricesById.get(item.stripePriceId) ?? null) : null;

        return (
          <div
            key={`${item.environment}:${item.stripeSubscriptionItemId}`}
            className="grid items-center border-b border-[var(--alpha-8)] px-4 py-3 text-sm last:border-0"
            style={{ gridTemplateColumns: SUBSCRIPTION_ITEM_GRID_TEMPLATE }}
          >
            <div className="min-w-0">
              <p
                className="truncate font-mono text-xs text-foreground"
                title={item.stripeSubscriptionItemId}
              >
                {item.stripeSubscriptionItemId}
              </p>
            </div>

            <div className="min-w-0">
              <p
                className="truncate text-foreground"
                title={product?.stripeProductId ?? item.stripeProductId ?? undefined}
              >
                {getSubscriptionItemProductLabel(item, product)}
              </p>
            </div>

            <div className="min-w-0">
              <p
                className="truncate text-foreground"
                title={price?.stripePriceId ?? item.stripePriceId ?? undefined}
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
  subscription: StripeSubscription;
  customer: StripeCustomer | null;
  productsById: Map<string, StripeProduct>;
  pricesById: Map<string, StripePrice>;
  expanded: boolean;
  onToggle: () => void;
}) {
  const items = subscription.items ?? [];
  const detailsId = `subscription-details-${subscription.stripeSubscriptionId}`;

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
              title={subscription.stripeSubscriptionId}
            >
              {subscription.stripeSubscriptionId}
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
            <SubscriptionStatus status={subscription.status} />
          </div>

          <div className="min-w-0 px-2 py-3">
            <span className="truncate text-foreground">{formatPeriod(subscription)}</span>
          </div>

          <div className="min-w-0 px-2 py-3">
            {subscription.latestInvoiceId ? (
              <span
                className="block truncate font-mono text-xs text-foreground"
                title={subscription.latestInvoiceId}
              >
                {subscription.latestInvoiceId}
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
                  Stripe items associated with this subscription, including product and price links.
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
  const { openPaymentsSettings, environment } = useOutletContext<PaymentsOutletContext>();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSubscriptionId, setExpandedSubscriptionId] = useState<string | null>(null);

  const { activeConnection, subscriptions, isLoading, error, refetch } =
    usePaymentSubscriptions(environment);
  const { customers } = usePaymentCustomers(environment);
  const { products, prices } = usePaymentCatalog(environment);

  useEffect(() => {
    setExpandedSubscriptionId(null);
  }, [environment]);

  const customersById = useMemo(() => {
    const nextCustomersById = new Map<string, StripeCustomer>();
    for (const customer of customers) {
      nextCustomersById.set(customer.stripeCustomerId, customer);
    }

    return nextCustomersById;
  }, [customers]);

  const productsById = useMemo(() => {
    const nextProductsById = new Map<string, StripeProduct>();
    for (const product of products) {
      nextProductsById.set(product.stripeProductId, product);
    }

    return nextProductsById;
  }, [products]);

  const pricesById = useMemo(() => {
    const nextPricesById = new Map<string, StripePrice>();
    for (const price of prices) {
      nextPricesById.set(price.stripePriceId, price);
    }

    return nextPricesById;
  }, [prices]);

  const filteredSubscriptions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    if (!normalizedSearch) {
      return subscriptions;
    }

    return subscriptions.filter((subscription) => {
      const customer = customersById.get(subscription.stripeCustomerId) ?? null;
      const itemValues = (subscription.items ?? []).flatMap((item) => {
        const product = item.stripeProductId
          ? (productsById.get(item.stripeProductId) ?? null)
          : null;
        const price = item.stripePriceId ? (pricesById.get(item.stripePriceId) ?? null) : null;

        return [
          item.stripeSubscriptionItemId,
          item.stripeProductId,
          item.stripePriceId,
          product?.name,
          price ? formatPriceAmount(price) : null,
        ];
      });

      return [
        subscription.stripeSubscriptionId,
        subscription.stripeCustomerId,
        customer?.email,
        customer?.name,
        subscription.status,
        subscription.latestInvoiceId,
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
        (subscription) => subscription.stripeSubscriptionId === expandedSubscriptionId
      )
    ) {
      setExpandedSubscriptionId(null);
    }
  }, [expandedSubscriptionId, filteredSubscriptions]);

  const handlePageChange = useCallback((_page: number) => {}, []);

  const hasActiveKey = !!activeConnection?.maskedKey;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Subscriptions"
        className="h-14 min-h-14"
        leftClassName="py-0"
        rightClassName="py-0"
        showDividerAfterTitle
        leftSlot={
          hasActiveKey ? (
            <span className="text-xs text-muted-foreground">
              Last synced: {formatLastSynced(activeConnection?.lastSyncedAt ?? null)}
            </span>
          ) : null
        }
        rightActions={null}
        showSearch={hasActiveKey}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search subscription"
        searchInputClassName="w-[280px]"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading Stripe subscriptions..." />
        ) : !hasActiveKey ? (
          <PaymentsKeyMissingState
            environment={environment}
            resourceLabel="subscriptions"
            onConfigure={openPaymentsSettings}
          />
        ) : (
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              <div className="flex flex-col gap-3">
                {activeConnection?.lastSyncError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Latest sync failed</AlertTitle>
                    <AlertDescription className="mt-2">
                      {activeConnection.lastSyncError}
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
                    {filteredSubscriptions.map((subscription) => (
                      <SubscriptionRow
                        key={`${subscription.environment}:${subscription.stripeSubscriptionId}`}
                        subscription={subscription}
                        customer={customersById.get(subscription.stripeCustomerId) ?? null}
                        productsById={productsById}
                        pricesById={pricesById}
                        expanded={expandedSubscriptionId === subscription.stripeSubscriptionId}
                        onToggle={() =>
                          setExpandedSubscriptionId((current) =>
                            current === subscription.stripeSubscriptionId
                              ? null
                              : subscription.stripeSubscriptionId
                          )
                        }
                      />
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
                totalRecords={filteredSubscriptions.length}
                pageSize={Math.max(filteredSubscriptions.length, 1)}
                recordLabel="subscriptions"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
