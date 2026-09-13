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

export const PAYMENT_CUSTOMERS_LIMIT = 100;

export function usePaymentCustomers(provider: PaymentProvider, environment: PaymentEnvironment) {
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
    data: customersData,
    isLoading: isLoadingCustomers,
    error: customersError,
    refetch: refetchCustomers,
    isFetching: isFetchingCustomers,
  } = useQuery({
    queryKey: stripeQueryKeys.customersByEnvironment(environment),
    queryFn: () =>
      stripeService.listCustomers({
        environment,
        limit: PAYMENT_CUSTOMERS_LIMIT,
      }),
    enabled: isStripeProvider && hasStripeKey,
    staleTime: 30 * 1000,
  });

  const {
    data: razorpayCustomersData,
    isLoading: isLoadingRazorpayCustomers,
    error: razorpayCustomersError,
    refetch: refetchRazorpayCustomers,
    isFetching: isFetchingRazorpayCustomers,
  } = useQuery({
    queryKey: razorpayQueryKeys.customersByEnvironment(environment),
    queryFn: () =>
      razorpayService.listCustomers({
        environment,
        limit: PAYMENT_CUSTOMERS_LIMIT,
      }),
    enabled: isRazorpayProvider && hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  const {
    data: paystackCustomersData,
    isLoading: isLoadingPaystackCustomers,
    error: paystackCustomersError,
    refetch: refetchPaystackCustomers,
    isFetching: isFetchingPaystackCustomers,
  } = useQuery({
    queryKey: paystackQueryKeys.customersByEnvironment(environment),
    queryFn: () =>
      paystackService.listCustomers({
        environment,
        limit: PAYMENT_CUSTOMERS_LIMIT,
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
    customers: hasActiveKey
      ? isStripeProvider
        ? (customersData?.customers ?? [])
        : isRazorpayProvider
          ? (razorpayCustomersData?.customers ?? [])
          : (paystackCustomersData?.customers ?? [])
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingCustomers))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpayCustomers))) ||
      (isPaystackProvider &&
        (isLoadingPaystackStatus || (hasPaystackKey && isLoadingPaystackCustomers))),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingCustomers))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpayCustomers))) ||
      (isPaystackProvider &&
        (isFetchingPaystackStatus || (hasPaystackKey && isFetchingPaystackCustomers))),
    error: isStripeProvider
      ? (statusError ?? customersError)
      : isRazorpayProvider
        ? (razorpayStatusError ?? razorpayCustomersError)
        : (paystackStatusError ?? paystackCustomersError),
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isPaystackProvider ? refetchPaystackStatus() : null,
        isStripeProvider && hasStripeKey ? refetchCustomers() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpayCustomers() : null,
        isPaystackProvider && hasPaystackKey ? refetchPaystackCustomers() : null,
      ]),
  };
}
