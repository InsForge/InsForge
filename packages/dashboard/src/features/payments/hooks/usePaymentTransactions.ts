import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PaymentEnvironment,
  PaymentProvider,
  RazorpayConnection,
} from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

const TRANSACTIONS_LIMIT = 100;

export function usePaymentTransactions(provider: PaymentProvider, environment: PaymentEnvironment) {
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
    enabled: isStripeProvider && hasStripeKey,
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
    enabled: isRazorpayProvider && hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    razorpayConnections,
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    transactions: hasActiveKey
      ? isStripeProvider
        ? (stripeTransactionsData?.transactions ?? [])
        : (razorpayTransactionsData?.transactions ?? [])
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingStripeTransactions))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpayTransactions))),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingStripeTransactions))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpayTransactions))),
    error: isStripeProvider
      ? (statusError ?? stripeTransactionsError)
      : (razorpayStatusError ?? razorpayTransactionsError),
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isStripeProvider && hasStripeKey ? refetchStripeTransactions() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpayTransactions() : null,
      ]),
  };
}
