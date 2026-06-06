import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RazorpayConnection, StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

const PAYMENT_HISTORY_LIMIT = 100;

export function usePaymentActivity(environment: StripeEnvironment) {
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
    data: paymentActivityData,
    isLoading: isLoadingPaymentActivity,
    error: paymentActivityError,
    refetch: refetchPaymentActivity,
    isFetching: isFetchingPaymentActivity,
  } = useQuery({
    queryKey: ['payments', 'stripe', 'payment-activity', environment],
    queryFn: () =>
      paymentsService.listPaymentActivity({
        environment,
        limit: PAYMENT_HISTORY_LIMIT,
      }),
    enabled: hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayPaymentActivityData,
    isLoading: isLoadingRazorpayPaymentActivity,
    error: razorpayPaymentActivityError,
    refetch: refetchRazorpayPaymentActivity,
    isFetching: isFetchingRazorpayPaymentActivity,
  } = useQuery({
    queryKey: ['payments', 'razorpay', 'payment-activity', environment],
    queryFn: () =>
      razorpayService.listPaymentActivity({
        environment,
        limit: PAYMENT_HISTORY_LIMIT,
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
    paymentActivity: hasActiveKey
      ? [
          ...(paymentActivityData?.paymentActivity ?? []),
          ...(razorpayPaymentActivityData?.paymentActivity ?? []),
        ]
      : [],
    isLoading:
      isLoadingStatus ||
      isLoadingRazorpayStatus ||
      (hasStripeKey && isLoadingPaymentActivity) ||
      (hasRazorpayKey && isLoadingRazorpayPaymentActivity),
    isRefreshing:
      isFetchingStatus ||
      isFetchingRazorpayStatus ||
      (hasStripeKey && isFetchingPaymentActivity) ||
      (hasRazorpayKey && isFetchingRazorpayPaymentActivity),
    error:
      statusError ?? razorpayStatusError ?? paymentActivityError ?? razorpayPaymentActivityError,
    refetch: () =>
      Promise.all([
        refetchStatus(),
        refetchRazorpayStatus(),
        hasStripeKey ? refetchPaymentActivity() : null,
        hasRazorpayKey ? refetchRazorpayPaymentActivity() : null,
      ]),
  };
}
