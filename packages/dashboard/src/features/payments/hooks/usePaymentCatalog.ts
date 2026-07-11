import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PaystackConnection,
  RazorpayConnection,
  PaymentEnvironment,
  PaymentProvider,
  RazorpayItem,
  RazorpayPlan,
  StripePrice,
  StripeProduct,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
import { paystackService } from '#features/payments/services/paystack.service';
import {
  paystackQueryKeys,
  razorpayQueryKeys,
  stripeQueryKeys,
} from '#features/payments/queryKeys';
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

function toRazorpayDisplayProduct(item: RazorpayItem): CatalogProduct {
  return {
    environment: item.environment,
    provider: 'razorpay',
    providerProductId: item.itemId,
    name: item.name,
    description: item.description,
    active: item.active,
    providerDefaultPriceId: null,
    metadata: {},
    syncedAt: item.syncedAt,
  };
}

function toRazorpayDisplayItemPrice(item: RazorpayItem): CatalogPrice {
  const unitAmountDecimal = item.unitAmount ?? item.amount;

  return {
    environment: item.environment,
    provider: 'razorpay',
    providerPriceId: item.itemId,
    providerProductId: item.itemId,
    active: item.active,
    currency: item.currency,
    unitAmount: item.amount,
    unitAmountDecimal: unitAmountDecimal === null ? null : String(unitAmountDecimal),
    type: 'one_time',
    lookupKey: null,
    billingScheme: 'per_unit',
    taxBehavior: null,
    recurringInterval: null,
    recurringIntervalCount: null,
    metadata: {},
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
    metadata: plan.notes,
    syncedAt: plan.syncedAt,
  };
}

export function usePaymentCatalog(provider: PaymentProvider, environment: PaymentEnvironment) {
  const isStripeProvider = provider === 'stripe';
  const isRazorpayProvider = provider === 'razorpay';
  const isPaystackProvider = provider === 'paystack';

  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
    isFetching: isFetchingStatus,
  } = useQuery({
    queryKey: stripeQueryKeys.status,
    queryFn: () => stripeService.getStatus(),
    enabled: isStripeProvider,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayStatusData,
    isLoading: isLoadingRazorpayStatus,
    error: razorpayStatusError,
    refetch: refetchRazorpayStatus,
    isFetching: isFetchingRazorpayStatus,
  } = useQuery({
    queryKey: razorpayQueryKeys.status,
    queryFn: () => razorpayService.getStatus(),
    enabled: isRazorpayProvider,
    staleTime: 30 * 1000,
  });

  const {
    data: paystackStatusData,
    isLoading: isLoadingPaystackStatus,
    error: paystackStatusError,
    refetch: refetchPaystackStatus,
    isFetching: isFetchingPaystackStatus,
  } = useQuery({
    queryKey: paystackQueryKeys.status,
    queryFn: () => paystackService.getStatus(),
    enabled: isPaystackProvider,
    staleTime: 30 * 1000,
  });

  const connections = useMemo(
    () => (isStripeProvider ? (statusData?.connections ?? []) : []),
    [isStripeProvider, statusData]
  );
  const razorpayConnections = useMemo(
    () => (isRazorpayProvider ? (razorpayStatusData?.razorpayConnections ?? []) : []),
    [isRazorpayProvider, razorpayStatusData]
  );
  const paystackConnections = useMemo(
    () => (isPaystackProvider ? (paystackStatusData?.paystackConnections ?? []) : []),
    [isPaystackProvider, paystackStatusData]
  );

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.environment === environment) ?? null,
    [connections, environment]
  );

  const activeRazorpayConnection = useMemo<RazorpayConnection | null>(
    () => razorpayConnections.find((connection) => connection.environment === environment) ?? null,
    [environment, razorpayConnections]
  );

  const activePaystackConnection = useMemo<PaystackConnection | null>(
    () => paystackConnections.find((connection) => connection.environment === environment) ?? null,
    [environment, paystackConnections]
  );

  const hasStripeKey = !!activeConnection?.maskedKey;
  const hasRazorpayKey = !!activeRazorpayConnection?.maskedKey;
  const hasPaystackKey = !!activePaystackConnection?.maskedKey;
  const hasActiveKey = isStripeProvider
    ? hasStripeKey
    : isRazorpayProvider
      ? hasRazorpayKey
      : hasPaystackKey;

  const {
    data: catalogData,
    isLoading: isLoadingCatalog,
    error: catalogError,
    refetch: refetchCatalog,
    isFetching: isFetchingCatalog,
  } = useQuery({
    queryKey: stripeQueryKeys.catalogByEnvironment(environment),
    queryFn: () => stripeService.listCatalog(environment),
    enabled: isStripeProvider && hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayCatalogData,
    isLoading: isLoadingRazorpayCatalog,
    error: razorpayCatalogError,
    refetch: refetchRazorpayCatalog,
    isFetching: isFetchingRazorpayCatalog,
  } = useQuery({
    queryKey: razorpayQueryKeys.catalogByEnvironment(environment),
    queryFn: () => razorpayService.listCatalog(environment),
    enabled: isRazorpayProvider && hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  const razorpayDisplayCatalog = useMemo(() => {
    const items = razorpayCatalogData?.items ?? [];
    const plans = razorpayCatalogData?.plans ?? [];
    const plannedItemIds = new Set(plans.map((plan) => plan.itemId));

    return {
      products: items.map((item) => toRazorpayDisplayProduct(item)),
      prices: [
        ...items
          .filter((item) => !plannedItemIds.has(item.itemId))
          .map((item) => toRazorpayDisplayItemPrice(item)),
        ...plans.map((plan) => toRazorpayDisplayPrice(plan)),
      ],
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
    paystackConnections,
    activeConnection,
    activeRazorpayConnection,
    activePaystackConnection,
    hasActiveKey,
    // Paystack has no catalog endpoints (phase 1), so its catalog is always empty.
    products: hasActiveKey
      ? isStripeProvider
        ? stripeDisplayCatalog.products
        : isRazorpayProvider
          ? razorpayDisplayCatalog.products
          : []
      : [],
    prices: hasActiveKey
      ? isStripeProvider
        ? stripeDisplayCatalog.prices
        : isRazorpayProvider
          ? razorpayDisplayCatalog.prices
          : []
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingCatalog))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpayCatalog))) ||
      (isPaystackProvider && isLoadingPaystackStatus),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingCatalog))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpayCatalog))) ||
      (isPaystackProvider && isFetchingPaystackStatus),
    error: isStripeProvider
      ? (statusError ?? catalogError)
      : isRazorpayProvider
        ? (razorpayStatusError ?? razorpayCatalogError)
        : paystackStatusError,
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isPaystackProvider ? refetchPaystackStatus() : null,
        isStripeProvider && hasStripeKey ? refetchCatalog() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpayCatalog() : null,
      ]),
  };
}
