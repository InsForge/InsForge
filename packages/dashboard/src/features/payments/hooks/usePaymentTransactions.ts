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

const TRANSACTIONS_LIMIT = 100;

export function usePaymentTransactions(provider: PaymentProvider, environment: PaymentEnvironment) {
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
    data: stripeTransactionsData,
    isLoading: isLoadingStripeTransactions,
    error: stripeTransactionsError,
    refetch: refetchStripeTransactions,
    isFetching: isFetchingStripeTransactions,
  } = useQuery({
    queryKey: stripeQueryKeys.transactionsByEnvironment(environment),
    queryFn: () =>
      stripeService.listTransactions({
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
    queryKey: razorpayQueryKeys.transactionsByEnvironment(environment),
    queryFn: () =>
      razorpayService.listTransactions({
        environment,
        limit: TRANSACTIONS_LIMIT,
      }),
    enabled: isRazorpayProvider && hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  const {
    data: paystackTransactionsData,
    isLoading: isLoadingPaystackTransactions,
    error: paystackTransactionsError,
    refetch: refetchPaystackTransactions,
    isFetching: isFetchingPaystackTransactions,
  } = useQuery({
    queryKey: paystackQueryKeys.transactionsByEnvironment(environment),
    queryFn: () =>
      paystackService.listTransactions({
        environment,
        limit: TRANSACTIONS_LIMIT,
      }),
    enabled: isPaystackProvider && hasPaystackKey,
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
    transactions: hasActiveKey
      ? isStripeProvider
        ? (stripeTransactionsData?.transactions ?? [])
        : isRazorpayProvider
          ? (razorpayTransactionsData?.transactions ?? [])
          : (paystackTransactionsData?.transactions ?? [])
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingStripeTransactions))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpayTransactions))) ||
      (isPaystackProvider &&
        (isLoadingPaystackStatus || (hasPaystackKey && isLoadingPaystackTransactions))),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingStripeTransactions))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpayTransactions))) ||
      (isPaystackProvider &&
        (isFetchingPaystackStatus || (hasPaystackKey && isFetchingPaystackTransactions))),
    error: isStripeProvider
      ? (statusError ?? stripeTransactionsError)
      : isRazorpayProvider
        ? (razorpayStatusError ?? razorpayTransactionsError)
        : (paystackStatusError ?? paystackTransactionsError),
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isPaystackProvider ? refetchPaystackStatus() : null,
        isStripeProvider && hasStripeKey ? refetchStripeTransactions() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpayTransactions() : null,
        isPaystackProvider && hasPaystackKey ? refetchPaystackTransactions() : null,
      ]),
  };
}
