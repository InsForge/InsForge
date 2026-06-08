import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RazorpayConnection, StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

const TRANSACTIONS_LIMIT = 100;

export function usePaymentTransactions(environment: StripeEnvironment) {
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
    data: stripeTransactionsData,
    isLoading: isLoadingStripeTransactions,
    error: stripeTransactionsError,
    refetch: refetchStripeTransactions,
    isFetching: isFetchingStripeTransactions,
  } = useQuery({
    queryKey: ['payments', 'stripe', 'transactions', environment],
    queryFn: () =>
      paymentsService.listTransactions({
        environment,
        limit: TRANSACTIONS_LIMIT,
      }),
    enabled: hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayTransactionsData,
    isLoading: isLoadingRazorpayTransactions,
    error: razorpayTransactionsError,
    refetch: refetchRazorpayTransactions,
    isFetching: isFetchingRazorpayTransactions,
  } = useQuery({
    queryKey: ['payments', 'razorpay', 'transactions', environment],
    queryFn: () =>
      razorpayService.listTransactions({
        environment,
        limit: TRANSACTIONS_LIMIT,
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
    transactions: hasActiveKey
      ? [
          ...(stripeTransactionsData?.transactions ?? []),
          ...(razorpayTransactionsData?.transactions ?? []),
        ]
      : [],
    isLoading:
      isLoadingStatus ||
      isLoadingRazorpayStatus ||
      (hasStripeKey && isLoadingStripeTransactions) ||
      (hasRazorpayKey && isLoadingRazorpayTransactions),
    isRefreshing:
      isFetchingStatus ||
      isFetchingRazorpayStatus ||
      (hasStripeKey && isFetchingStripeTransactions) ||
      (hasRazorpayKey && isFetchingRazorpayTransactions),
    error:
      statusError ?? razorpayStatusError ?? stripeTransactionsError ?? razorpayTransactionsError,
    refetch: () =>
      Promise.all([
        refetchStatus(),
        refetchRazorpayStatus(),
        hasStripeKey ? refetchStripeTransactions() : null,
        hasRazorpayKey ? refetchRazorpayTransactions() : null,
      ]),
  };
}
