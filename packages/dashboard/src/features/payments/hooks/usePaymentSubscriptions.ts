import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PaymentEnvironment,
  PaymentProvider,
  PaystackConnection,
  RazorpayConnection,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
import { paystackService } from '#features/payments/services/paystack.service';
import {
  paystackQueryKeys,
  razorpayQueryKeys,
  stripeQueryKeys,
} from '#features/payments/queryKeys';
import {
  normalizeRazorpaySubscription,
  normalizeStripeSubscription,
} from '#features/payments/types/subscriptions';

const SUBSCRIPTIONS_LIMIT = 100;

export function usePaymentSubscriptions(
  provider: PaymentProvider,
  environment: PaymentEnvironment
) {
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
    data: subscriptionsData,
    isLoading: isLoadingSubscriptions,
    error: subscriptionsError,
    refetch: refetchSubscriptions,
    isFetching: isFetchingSubscriptions,
  } = useQuery({
    queryKey: stripeQueryKeys.subscriptionsByEnvironment(environment),
    queryFn: () =>
      stripeService.listSubscriptions({
        environment,
        limit: SUBSCRIPTIONS_LIMIT,
      }),
    enabled: isStripeProvider && hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpaySubscriptionsData,
    isLoading: isLoadingRazorpaySubscriptions,
    error: razorpaySubscriptionsError,
    refetch: refetchRazorpaySubscriptions,
    isFetching: isFetchingRazorpaySubscriptions,
  } = useQuery({
    queryKey: razorpayQueryKeys.subscriptionsByEnvironment(environment),
    queryFn: () =>
      razorpayService.listSubscriptions({
        environment,
        limit: SUBSCRIPTIONS_LIMIT,
      }),
    enabled: isRazorpayProvider && hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    razorpayConnections,
    paystackConnections,
    activeConnection,
    activeRazorpayConnection,
    activePaystackConnection,
    hasActiveKey,
    // Paystack has no subscriptions endpoints (phase 1), so its list is always empty.
    subscriptions: hasActiveKey
      ? isStripeProvider
        ? (subscriptionsData?.subscriptions.map(normalizeStripeSubscription) ?? [])
        : isRazorpayProvider
          ? (razorpaySubscriptionsData?.subscriptions.map(normalizeRazorpaySubscription) ?? [])
          : []
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingSubscriptions))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpaySubscriptions))) ||
      (isPaystackProvider && isLoadingPaystackStatus),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingSubscriptions))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpaySubscriptions))) ||
      (isPaystackProvider && isFetchingPaystackStatus),
    error: isStripeProvider
      ? (statusError ?? subscriptionsError)
      : isRazorpayProvider
        ? (razorpayStatusError ?? razorpaySubscriptionsError)
        : paystackStatusError,
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isPaystackProvider ? refetchPaystackStatus() : null,
        isStripeProvider && hasStripeKey ? refetchSubscriptions() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpaySubscriptions() : null,
      ]),
  };
}
