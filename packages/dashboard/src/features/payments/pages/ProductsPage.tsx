import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Button, Tab, Tabs } from '@insforge/ui';
import { Alert, AlertDescription, AlertTitle } from '../../../components/radix';
import { ErrorState, LoadingState, TableHeader } from '../../../components';
import { usePayments } from '../hooks/usePayments';
import type {
  StripeEnvironment,
  StripePriceMirror,
  StripeProductMirror,
} from '@insforge/shared-schemas';

const ENVIRONMENTS: StripeEnvironment[] = ['test', 'live'];

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

function formatAmount(price: StripePriceMirror) {
  const rawAmount =
    price.unitAmount ?? (price.unitAmountDecimal ? Number(price.unitAmountDecimal) : null);

  if (rawAmount === null || Number.isNaN(rawAmount)) {
    return 'Custom';
  }

  return `${price.currency.toUpperCase()} ${(rawAmount / 100).toFixed(2)}`;
}

function formatBilling(price: StripePriceMirror) {
  if (price.type !== 'recurring' || !price.recurringInterval) {
    return 'One time';
  }

  const intervalCount = price.recurringIntervalCount ?? 1;
  return intervalCount === 1
    ? `Every ${price.recurringInterval}`
    : `Every ${intervalCount} ${price.recurringInterval}s`;
}

function StatusBadge({
  active,
  label,
  tone = 'default',
}: {
  active: boolean;
  label: string;
  tone?: 'default' | 'primary';
}) {
  const activeClass =
    tone === 'primary'
      ? 'bg-primary/20 text-primary ring-primary/30'
      : 'bg-emerald-50 text-emerald-700 ring-emerald-200';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
        active ? activeClass : 'bg-[var(--alpha-3)] text-muted-foreground ring-[var(--alpha-8)]'
      }`}
    >
      {label}
    </span>
  );
}

function ConfigureStripeKeyCallout({ environment }: { environment: StripeEnvironment }) {
  return (
    <Alert className="mx-auto w-4/5 max-w-[1024px] border-amber-200 bg-amber-50 text-amber-950">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Configure a Stripe {environment} key</AlertTitle>
      <AlertDescription className="mt-2">
        Open the Payments settings from the sidebar gear button and add a{' '}
        <span className="font-mono">{environment === 'test' ? 'sk_test_' : 'sk_live_'}</span>
        secret key before syncing products.
      </AlertDescription>
    </Alert>
  );
}

function ProductStatus({ product }: { product: StripeProductMirror }) {
  return <StatusBadge active={product.active} label={product.active ? 'Active' : 'Inactive'} />;
}

function ProductTable({
  products,
  pricesByProductId,
  onSelectProduct,
}: {
  products: StripeProductMirror[];
  pricesByProductId: Map<string, StripePriceMirror[]>;
  onSelectProduct: (product: StripeProductMirror) => void;
}) {
  if (products.length === 0) {
    return (
      <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col items-center justify-center rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No products found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync Stripe after creating products in your Stripe dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-1">
      {products.map((product) => {
        const productPrices = pricesByProductId.get(product.stripeProductId) ?? [];

        return (
          <button
            key={`${product.environment}:${product.stripeProductId}`}
            type="button"
            onClick={() => onSelectProduct(product)}
            className="rounded border border-[var(--alpha-8)] bg-card text-left"
          >
            <div className="flex cursor-pointer items-center rounded transition-colors hover:bg-[var(--alpha-8)]">
              <div className="flex w-[30px] shrink-0 items-center justify-center">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="flex h-12 min-w-0 flex-[1.5] flex-col justify-center px-2.5">
                <p className="truncate text-sm font-medium leading-[18px] text-foreground">
                  {product.name}
                </p>
                <p className="truncate font-mono text-xs leading-4 text-muted-foreground">
                  {product.stripeProductId}
                </p>
              </div>

              <div className="flex h-12 w-[120px] shrink-0 items-center px-2.5">
                <ProductStatus product={product} />
              </div>

              <div className="flex h-12 w-[100px] shrink-0 items-center px-2.5">
                <span className="text-sm leading-[18px] text-foreground">
                  {productPrices.length}
                </span>
              </div>

              <div className="flex h-12 min-w-0 flex-1 items-center px-2.5">
                <span
                  className="block truncate font-mono text-xs leading-[18px] text-muted-foreground"
                  title={product.defaultPriceId ?? ''}
                >
                  {product.defaultPriceId ?? '-'}
                </span>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProductDetailCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-[var(--alpha-8)] bg-card p-4">
      <p className="mb-1 text-sm text-muted-foreground">{label}</p>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

function PricesForProductTable({
  product,
  prices,
}: {
  product: StripeProductMirror;
  prices: StripePriceMirror[];
}) {
  if (prices.length === 0) {
    return (
      <div className="rounded border border-dashed border-[var(--alpha-8)] bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">No prices synced for this product</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Prices attached to this Stripe product will appear after the next sync.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="grid grid-cols-[minmax(180px,1.2fr)_120px_150px_150px] border-b border-[var(--alpha-8)] px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <div>Price</div>
        <div>Amount</div>
        <div>Billing</div>
        <div>Status</div>
      </div>
      {prices.map((price) => {
        const isDefault = price.stripePriceId === product.defaultPriceId;
        return (
          <div
            key={`${price.environment}:${price.stripePriceId}`}
            className="grid grid-cols-[minmax(180px,1.2fr)_120px_150px_150px] items-center border-b border-[var(--alpha-6)] px-4 py-3 text-sm last:border-0"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-mono text-xs text-foreground">{price.stripePriceId}</p>
                {isDefault && <StatusBadge active label="Default" tone="primary" />}
              </div>
              {price.lookupKey && (
                <p className="truncate text-xs text-muted-foreground">{price.lookupKey}</p>
              )}
            </div>
            <div className="font-medium text-foreground">{formatAmount(price)}</div>
            <div className="text-muted-foreground">{formatBilling(price)}</div>
            <div>
              <StatusBadge active={price.active} label={price.active ? 'Active' : 'Inactive'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProductDetail({
  product,
  prices,
  onBack,
}: {
  product: StripeProductMirror;
  prices: StripePriceMirror[];
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))] px-4">
        <button
          type="button"
          onClick={onBack}
          className="text-base font-medium leading-7 text-muted-foreground transition-colors hover:text-foreground"
        >
          Products
        </button>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
        <p className="truncate text-base font-medium leading-7 text-foreground">{product.name}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <ProductDetailCard label="Status" value={<ProductStatus product={product} />} />
            <ProductDetailCard label="Prices" value={prices.length} />
            <ProductDetailCard
              label="Default price"
              value={
                product.defaultPriceId ? (
                  <span className="font-mono text-xs">{product.defaultPriceId}</span>
                ) : (
                  '-'
                )
              }
            />
          </div>

          <div className="rounded border border-[var(--alpha-8)] bg-card p-4">
            <p className="mb-2 text-sm text-muted-foreground">Product</p>
            <p className="text-sm font-medium text-foreground">{product.name}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {product.stripeProductId}
            </p>
            {product.description && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{product.description}</p>
            )}
          </div>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-base font-medium text-foreground">Prices</h2>
              <p className="text-sm text-muted-foreground">
                Prices associated with this product. Active prices and the default price are
                labeled.
              </p>
            </div>
            <PricesForProductTable product={product} prices={prices} />
          </section>
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  const [environment, setEnvironment] = useState<StripeEnvironment>('test');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<StripeProductMirror | null>(null);
  const {
    connections,
    activeConnection,
    products,
    prices,
    isLoading,
    isSyncing,
    error,
    syncCatalog,
    refetch,
  } = usePayments(environment);

  useEffect(() => {
    setSelectedProduct(null);
  }, [environment]);

  const pricesByProductId = useMemo(() => {
    const nextPricesByProductId = new Map<string, StripePriceMirror[]>();
    for (const price of prices) {
      if (!price.stripeProductId) {
        continue;
      }

      const productPrices = nextPricesByProductId.get(price.stripeProductId) ?? [];
      productPrices.push(price);
      nextPricesByProductId.set(price.stripeProductId, productPrices);
    }

    return nextPricesByProductId;
  }, [prices]);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) {
      return products;
    }

    const normalizedSearch = searchQuery.toLowerCase();
    return products.filter((product) =>
      [product.name, product.description, product.stripeProductId, product.defaultPriceId]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch))
    );
  }, [products, searchQuery]);

  const selectedProductPrices = selectedProduct
    ? (pricesByProductId.get(selectedProduct.stripeProductId) ?? [])
    : [];
  const hasActiveKey = !!activeConnection?.maskedKey;
  const hasAnyKey = connections.some((connection) => !!connection.maskedKey);

  if (selectedProduct) {
    return (
      <ProductDetail
        product={selectedProduct}
        prices={selectedProductPrices}
        onBack={() => setSelectedProduct(null)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Products"
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
        rightActions={
          <>
            <span className="text-xs text-muted-foreground">
              Last synced: {formatLastSynced(activeConnection?.lastSyncedAt ?? null)}
            </span>
            <Button
              variant="secondary"
              onClick={() => void syncCatalog()}
              disabled={!hasAnyKey || isSyncing}
              className="h-9 rounded px-3"
            >
              {isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync Stripe
            </Button>
          </>
        }
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchDebounceTime={300}
        searchPlaceholder="Search products"
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="h-10" />

        <div className="sticky top-0 z-10 bg-[rgb(var(--semantic-1))] px-3">
          <div className="mx-auto w-4/5 max-w-[1024px]">
            <div className="flex h-8 items-center text-sm text-muted-foreground">
              <div className="w-[30px] shrink-0" />
              <div className="flex-[1.5] px-2.5 py-1.5">Product</div>
              <div className="w-[120px] shrink-0 px-2.5 py-1.5">Status</div>
              <div className="w-[100px] shrink-0 px-2.5 py-1.5">Prices</div>
              <div className="flex-1 px-2.5 py-1.5">Default Price</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-3 pb-4 pt-1">
          {!hasActiveKey && <ConfigureStripeKeyCallout environment={environment} />}

          {activeConnection?.lastSyncError && (
            <Alert variant="destructive" className="mx-auto w-4/5 max-w-[1024px]">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Latest sync failed</AlertTitle>
              <AlertDescription className="mt-2">{activeConnection.lastSyncError}</AlertDescription>
            </Alert>
          )}

          {error ? (
            <ErrorState error={error as Error} onRetry={() => void refetch()} />
          ) : isLoading ? (
            <LoadingState message="Loading Stripe products..." />
          ) : (
            <ProductTable
              products={filteredProducts}
              pricesByProductId={pricesByProductId}
              onSelectProduct={setSelectedProduct}
            />
          )}
        </div>
      </div>
    </div>
  );
}
