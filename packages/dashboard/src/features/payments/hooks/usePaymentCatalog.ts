import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  RazorpayConnection,
  RazorpayItem,
  RazorpayPlan,
  StripePrice,
  StripeProduct,
  StripeEnvironment,
} from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
import type { CatalogPrice, CatalogProduct } from '#features/payments/types/catalog';

const RAZORPAY_RECURRING_INTERVAL_MAP: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

function toStripeDisplayProduct(product: StripeProduct): CatalogProduct {
  return {
    environment: product.environment,
    provider: 'stripe',
    providerProductId: product.productId,
    name: product.name,
    description: product.description,
    active: product.active,
    providerDefaultPriceId: product.defaultPriceId,
    metadata: product.metadata,
    syncedAt: product.syncedAt,
  };
}

function toStripeDisplayPrice(price: StripePrice): CatalogPrice {
  return {
    environment: price.environment,
    provider: 'stripe',
    providerPriceId: price.priceId,
    providerProductId: price.productId,
    active: price.active,
    currency: price.currency,
    unitAmount: price.unitAmount,
    unitAmountDecimal: price.unitAmountDecimal,
    type: price.type,
    lookupKey: price.lookupKey,
    billingScheme: price.billingScheme,
    taxBehavior: price.taxBehavior,
    recurringInterval: price.recurringInterval,
    recurringIntervalCount: price.recurringIntervalCount,
    metadata: price.metadata,
    syncedAt: price.syncedAt,
  };
}

function toRazorpayDisplayProduct(item: RazorpayItem, plans: RazorpayPlan[]): CatalogProduct {
  return {
    environment: item.environment,
    provider: 'razorpay',
    providerProductId: item.itemId,
    name: item.name,
    description: item.description,
    active: item.active,
    providerDefaultPriceId: plans.find((plan) => plan.itemId === item.itemId)?.planId ?? null,
    metadata: item.metadata,
    syncedAt: item.syncedAt,
  };
}

function toRazorpayDisplayPrice(plan: RazorpayPlan): CatalogPrice {
  const unitAmountDecimal = plan.unitAmount ?? plan.amount;

  return {
    environment: plan.environment,
    provider: 'razorpay',
    providerPriceId: plan.planId,
    providerProductId: plan.itemId,
    active: plan.active,
    currency: plan.currency,
    unitAmount: plan.amount,
    unitAmountDecimal: unitAmountDecimal === null ? null : String(unitAmountDecimal),
    type: 'recurring',
    lookupKey: null,
    billingScheme: 'per_unit',
    taxBehavior: null,
    recurringInterval: RAZORPAY_RECURRING_INTERVAL_MAP[plan.period] ?? plan.period,
    recurringIntervalCount: plan.interval,
    metadata: plan.metadata,
    syncedAt: plan.syncedAt,
  };
}

export function usePaymentCatalog(environment: StripeEnvironment) {
  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
    isFetching: isFetchingStatus,
  } = useQuery({
    queryKey: ['payments', 'status'],
    queryFn: () => paymentsService.getStatus(),
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayStatusData,
    isLoading: isLoadingRazorpayStatus,
    error: razorpayStatusError,
    refetch: refetchRazorpayStatus,
    isFetching: isFetchingRazorpayStatus,
  } = useQuery({
    queryKey: ['payments', 'razorpay', 'status'],
    queryFn: () => razorpayService.getStatus(),
    staleTime: 30 * 1000,
  });

  const connections = useMemo(() => statusData?.connections ?? [], [statusData]);
  const razorpayConnections = useMemo(
    () => razorpayStatusData?.razorpayConnections ?? [],
    [razorpayStatusData]
  );

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.environment === environment) ?? null,
    [connections, environment]
  );

  const activeRazorpayConnection = useMemo<RazorpayConnection | null>(
    () => razorpayConnections.find((connection) => connection.environment === environment) ?? null,
    [environment, razorpayConnections]
  );

  const hasStripeKey = !!activeConnection?.maskedKey;
  const hasRazorpayKey = !!activeRazorpayConnection?.maskedKey;
  const hasActiveKey = hasStripeKey || hasRazorpayKey;

  const {
    data: catalogData,
    isLoading: isLoadingCatalog,
    error: catalogError,
    refetch: refetchCatalog,
    isFetching: isFetchingCatalog,
  } = useQuery({
    queryKey: ['payments', 'stripe', 'catalog', environment],
    queryFn: () => paymentsService.listCatalog(environment),
    enabled: hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayCatalogData,
    isLoading: isLoadingRazorpayCatalog,
    error: razorpayCatalogError,
    refetch: refetchRazorpayCatalog,
    isFetching: isFetchingRazorpayCatalog,
  } = useQuery({
    queryKey: ['payments', 'razorpay', 'catalog', environment],
    queryFn: () => razorpayService.listCatalog(environment),
    enabled: hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  const razorpayDisplayCatalog = useMemo(() => {
    const plans = razorpayCatalogData?.plans ?? [];
    return {
      products: (razorpayCatalogData?.items ?? []).map((item) =>
        toRazorpayDisplayProduct(item, plans)
      ),
      prices: plans.map((plan) => toRazorpayDisplayPrice(plan)),
    };
  }, [razorpayCatalogData]);

  const stripeDisplayCatalog = useMemo(
    () => ({
      products: (catalogData?.products ?? []).map((product) => toStripeDisplayProduct(product)),
      prices: (catalogData?.prices ?? []).map((price) => toStripeDisplayPrice(price)),
    }),
    [catalogData]
  );

  return {
    connections,
    razorpayConnections,
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    products: hasActiveKey
      ? [...stripeDisplayCatalog.products, ...razorpayDisplayCatalog.products]
      : [],
    prices: hasActiveKey ? [...stripeDisplayCatalog.prices, ...razorpayDisplayCatalog.prices] : [],
    isLoading:
      isLoadingStatus ||
      isLoadingRazorpayStatus ||
      (hasStripeKey && isLoadingCatalog) ||
      (hasRazorpayKey && isLoadingRazorpayCatalog),
    isRefreshing:
      isFetchingStatus ||
      isFetchingRazorpayStatus ||
      (hasStripeKey && isFetchingCatalog) ||
      (hasRazorpayKey && isFetchingRazorpayCatalog),
    error: statusError ?? razorpayStatusError ?? catalogError ?? razorpayCatalogError,
    refetch: () =>
      Promise.all([
        refetchStatus(),
        refetchRazorpayStatus(),
        hasStripeKey ? refetchCatalog() : null,
        hasRazorpayKey ? refetchRazorpayCatalog() : null,
      ]),
  };
}
