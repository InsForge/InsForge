import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PaymentEnvironment,
  PaymentProvider,
  RazorpayConnection,
} from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
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

  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
    isFetching: isFetchingStatus,
  } = useQuery({
    queryKey: ['payments', 'status'],
    queryFn: () => paymentsService.getStatus(),
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
    queryKey: ['payments', 'razorpay', 'status'],
    queryFn: () => razorpayService.getStatus(),
    enabled: isRazorpayProvider,
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
  const hasActiveKey = isStripeProvider ? hasStripeKey : hasRazorpayKey;

  const {
    data: subscriptionsData,
    isLoading: isLoadingSubscriptions,
    error: subscriptionsError,
    refetch: refetchSubscriptions,
    isFetching: isFetchingSubscriptions,
  } = useQuery({
    queryKey: ['payments', 'stripe', 'subscriptions', environment],
    queryFn: () =>
      paymentsService.listSubscriptions({
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
    queryKey: ['payments', 'razorpay', 'subscriptions', environment],
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
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    subscriptions: hasActiveKey
      ? isStripeProvider
        ? (subscriptionsData?.subscriptions.map(normalizeStripeSubscription) ?? [])
        : (razorpaySubscriptionsData?.subscriptions.map(normalizeRazorpaySubscription) ?? [])
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingSubscriptions))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpaySubscriptions))),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingSubscriptions))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpaySubscriptions))),
    error: isStripeProvider
      ? (statusError ?? subscriptionsError)
      : (razorpayStatusError ?? razorpaySubscriptionsError),
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isStripeProvider && hasStripeKey ? refetchSubscriptions() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpaySubscriptions() : null,
      ]),
  };
}
