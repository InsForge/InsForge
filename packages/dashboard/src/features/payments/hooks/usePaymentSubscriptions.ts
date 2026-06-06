import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RazorpayConnection, StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';
import {
  normalizeRazorpaySubscription,
  normalizeStripeSubscription,
} from '#features/payments/types/subscriptions';

const SUBSCRIPTIONS_LIMIT = 100;

export function usePaymentSubscriptions(environment: StripeEnvironment) {
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
    enabled: hasStripeKey,
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
    enabled: hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    razorpayConnections,
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    subscriptions: hasActiveKey
      ? [
          ...(subscriptionsData?.subscriptions.map(normalizeStripeSubscription) ?? []),
          ...(razorpaySubscriptionsData?.subscriptions.map(normalizeRazorpaySubscription) ?? []),
        ]
      : [],
    isLoading:
      isLoadingStatus ||
      isLoadingRazorpayStatus ||
      (hasStripeKey && isLoadingSubscriptions) ||
      (hasRazorpayKey && isLoadingRazorpaySubscriptions),
    isRefreshing:
      isFetchingStatus ||
      isFetchingRazorpayStatus ||
      (hasStripeKey && isFetchingSubscriptions) ||
      (hasRazorpayKey && isFetchingRazorpaySubscriptions),
    error: statusError ?? razorpayStatusError ?? subscriptionsError ?? razorpaySubscriptionsError,
    refetch: () =>
      Promise.all([
        refetchStatus(),
        refetchRazorpayStatus(),
        hasStripeKey ? refetchSubscriptions() : null,
        hasRazorpayKey ? refetchRazorpaySubscriptions() : null,
      ]),
  };
}
