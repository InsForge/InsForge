import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { CatalogPrice, CatalogProduct } from '#features/payments/types/catalog';
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
import { formatLastSynced, formatPriceAmount } from '#features/payments/format';

const CATALOG_ROW_GRID_TEMPLATE = '32px minmax(240px,1.5fr) 100px 90px 140px minmax(220px,1fr)';

function formatBilling(price: CatalogPrice) {
  if (price.type !== 'recurring' || !price.recurringInterval) {
    return 'One time';
  }

  const intervalCount = price.recurringIntervalCount ?? 1;
  return intervalCount === 1
    ? `Every ${price.recurringInterval}`
    : `Every ${intervalCount} ${price.recurringInterval}s`;
}

function sortProductPrices(prices: CatalogPrice[], defaultPriceId: string | null) {
  return [...prices].sort((left, right) => {
    const leftIsDefault = left.providerPriceId === defaultPriceId;
    const rightIsDefault = right.providerPriceId === defaultPriceId;

    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }

    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }

    if (left.lookupKey && right.lookupKey) {
      return left.lookupKey.localeCompare(right.lookupKey);
    }

    if (left.lookupKey || right.lookupKey) {
      return left.lookupKey ? -1 : 1;
    }

    return left.providerPriceId.localeCompare(right.providerPriceId);
  });
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'info' | 'neutral';
}) {
  const toneClassName = {
    success: 'bg-[var(--alpha-8)] text-emerald-400',
    warning: 'bg-[var(--alpha-8)] text-amber-400',
    info: 'bg-primary/20 text-primary',
    neutral: 'bg-[var(--alpha-8)] text-muted-foreground',
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${toneClassName}`}
    >
      {label}
    </span>
  );
}

function EmptyCatalogState({ hasSearchQuery }: { hasSearchQuery: boolean }) {
  return (
    <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {hasSearchQuery ? 'No products match your search' : 'No products found'}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasSearchQuery
          ? 'Try a different product name, ID, or pricing reference.'
          : 'Open Payments Settings and sync after creating products in your provider dashboard.'}
      </p>
    </div>
  );
}

function ProductPricesTable({
  product,
  prices,
}: {
  product: CatalogProduct;
  prices: CatalogPrice[];
}) {
  if (prices.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-6 text-center">
        <p className="text-sm font-medium text-foreground">No prices synced for this product</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Prices attached to this product will appear after the next sync.
        </p>
      </div>
    );
  }

  const sortedPrices = sortProductPrices(prices, product.providerDefaultPriceId);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[920px] overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
        <div className="grid grid-cols-[160px_120px_140px_minmax(220px,1fr)_minmax(180px,1fr)] border-b border-[var(--alpha-8)] bg-alpha-4 px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>Amount</div>
          <div>Status</div>
          <div>Billing</div>
          <div>Price ID</div>
          <div>Lookup Key</div>
        </div>

        {sortedPrices.map((price) => {
          const isDefault =
            product.provider === 'stripe' &&
            price.providerPriceId === product.providerDefaultPriceId;

          return (
            <div
              key={`${price.environment}:${price.providerPriceId}`}
              className="grid grid-cols-[160px_120px_140px_minmax(220px,1fr)_minmax(180px,1fr)] items-center border-b border-[var(--alpha-8)] px-4 py-3 text-sm last:border-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-foreground">{formatPriceAmount(price)}</span>
                  {isDefault && <StatusBadge label="Default" tone="info" />}
                </div>
              </div>

              <div>
                <StatusBadge
                  label={price.active ? 'Active' : 'Inactive'}
                  tone={price.active ? 'success' : 'warning'}
                />
              </div>

              <div className="min-w-0 truncate text-muted-foreground">{formatBilling(price)}</div>

              <div className="min-w-0">
                <p
                  className="truncate font-mono text-xs text-foreground"
                  title={price.providerPriceId}
                >
                  {price.providerPriceId}
                </p>
              </div>

              <div className="min-w-0">
                {price.lookupKey ? (
                  <p className="truncate font-mono text-xs text-foreground" title={price.lookupKey}>
                    {price.lookupKey}
                  </p>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CatalogRow({
  product,
  productPrices,
  summaryPrice,
  expanded,
  onToggle,
}: {
  product: CatalogProduct;
  productPrices: CatalogPrice[];
  summaryPrice: CatalogPrice | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left transition-colors hover:bg-alpha-4"
      >
        <div
          className="grid min-h-12 items-center gap-0 px-2 text-sm"
          style={{ gridTemplateColumns: CATALOG_ROW_GRID_TEMPLATE }}
        >
          <div className="flex items-center justify-center text-muted-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>

          <div className="min-w-0 px-2 py-3">
            <p className="truncate text-foreground">{product.name}</p>
          </div>

          <div className="px-2 py-3">
            <StatusBadge
              label={product.active ? 'Active' : 'Inactive'}
              tone={product.active ? 'success' : 'warning'}
            />
          </div>

          <div className="px-2 py-3 text-foreground">{productPrices.length}</div>

          <div className="min-w-0 px-2 py-3">
            {summaryPrice ? (
              <span className="truncate text-foreground">{formatPriceAmount(summaryPrice)}</span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>

          <div className="min-w-0 px-2 py-3">
            <span
              className="block truncate font-mono text-xs text-muted-foreground"
              title={product.providerProductId}
            >
              {product.providerProductId}
            </span>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--alpha-8)] px-4 py-4">
          <div className="flex flex-col gap-4">
            <section>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </p>
              <p className="mt-2 text-sm leading-6 text-foreground">
                {product.description?.trim() || 'No description set for this product.'}
              </p>
            </section>

            <div className="h-px bg-[var(--alpha-8)]" />

            <section className="flex flex-col gap-2">
              <div>
                <h2 className="text-sm font-medium text-foreground">Prices</h2>
                <p className="text-sm text-muted-foreground">
                  Active prices, price IDs, and lookup keys are shown here.
                </p>
              </div>
              <ProductPricesTable product={product} prices={productPrices} />
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CatalogPage() {
  const { openPaymentsSettings, provider, setProvider, environment } =
    useOutletContext<PaymentsOutletContext>();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const {
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    products,
    prices,
    isLoading,
    error,
    refetch,
  } = usePaymentCatalog(provider, environment);

  useEffect(() => {
    setExpandedProductId(null);
  }, [environment, provider]);

  const pricesByProductId = useMemo(() => {
    const nextPricesByProductId = new Map<string, CatalogPrice[]>();
    for (const price of prices) {
      if (!price.providerProductId) {
        continue;
      }

      const productPrices = nextPricesByProductId.get(price.providerProductId) ?? [];
      productPrices.push(price);
      nextPricesByProductId.set(price.providerProductId, productPrices);
    }

    return nextPricesByProductId;
  }, [prices]);

  const pricesById = useMemo(() => {
    const nextPricesById = new Map<string, CatalogPrice>();
    for (const price of prices) {
      nextPricesById.set(price.providerPriceId, price);
    }

    return nextPricesById;
  }, [prices]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) {
      return products;
    }

    const normalizedSearch = searchQuery.toLowerCase();
    return products.filter((product) =>
      [product.name, product.description, product.providerProductId, product.providerDefaultPriceId]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch))
    );
  }, [products, searchQuery]);

  useEffect(() => {
    if (
      expandedProductId &&
      !filteredProducts.some((product) => product.providerProductId === expandedProductId)
    ) {
      setExpandedProductId(null);
    }
  }, [expandedProductId, filteredProducts]);

  const {
    currentPage,
    setCurrentPage,
    totalPages,
    pageSize,
    startIndex,
    endIndex,
    showPagination,
  } = usePaymentClientPagination(filteredProducts.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [environment, provider, searchQuery, setCurrentPage]);

  const paginatedProducts = useMemo(
    () => filteredProducts.slice(startIndex, endIndex),
    [endIndex, filteredProducts, startIndex]
  );

  const lastSyncedTimes = [
    activeConnection?.lastSyncedAt,
    activeRazorpayConnection?.lastSyncedAt,
  ].filter((value): value is string => Boolean(value));

  const mostRecentSync =
    (lastSyncedTimes.length > 0
      ? [...lastSyncedTimes].sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]
      : null) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      {hasActiveKey && (
        <TableHeader
          className="h-14 min-h-14"
          leftClassName="py-0"
          rightClassName="py-0"
          title="Catalog"
          showDividerAfterTitle
          leftSlot={
            <span className="text-xs text-muted-foreground">
              Last synced: {formatLastSynced(mostRecentSync)}
            </span>
          }
          showSearch
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchDebounceTime={300}
          searchPlaceholder="Search product"
          searchInputClassName="w-[280px]"
        />
      )}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <ErrorState error={error as Error} onRetry={() => void refetch()} />
        ) : isLoading ? (
          <LoadingState message="Loading catalog..." />
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
              <div className="flex min-w-[960px] flex-col gap-3">
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
                  style={{ gridTemplateColumns: CATALOG_ROW_GRID_TEMPLATE }}
                >
                  <div />
                  <div className="px-2 py-1.5">Product</div>
                  <div className="px-2 py-1.5">Status</div>
                  <div className="px-2 py-1.5">Prices</div>
                  <div className="px-2 py-1.5">
                    {provider === 'stripe' ? 'Default Price' : 'Amount'}
                  </div>
                  <div className="px-2 py-1.5">Product ID</div>
                </div>

                {filteredProducts.length === 0 ? (
                  <EmptyCatalogState hasSearchQuery={searchQuery.trim().length > 0} />
                ) : (
                  <div className="flex flex-col gap-2">
                    {paginatedProducts.map((product) => {
                      const productPrices = pricesByProductId.get(product.providerProductId) ?? [];
                      const summaryPrice =
                        product.provider === 'stripe'
                          ? product.providerDefaultPriceId
                            ? (pricesById.get(product.providerDefaultPriceId) ?? null)
                            : null
                          : (sortProductPrices(productPrices, null)[0] ?? null);

                      return (
                        <CatalogRow
                          key={`${product.environment}:${product.providerProductId}`}
                          product={product}
                          productPrices={productPrices}
                          summaryPrice={summaryPrice}
                          expanded={expandedProductId === product.providerProductId}
                          onToggle={() =>
                            setExpandedProductId((current) =>
                              current === product.providerProductId
                                ? null
                                : product.providerProductId
                            )
                          }
                        />
                      );
                    })}
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
                  totalRecords={filteredProducts.length}
                  pageSize={pageSize}
                  recordLabel="products"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
