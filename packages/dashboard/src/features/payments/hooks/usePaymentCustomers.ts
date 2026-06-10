import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  PaymentEnvironment,
  PaymentProvider,
  RazorpayConnection,
} from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

export const PAYMENT_CUSTOMERS_LIMIT = 100;

export function usePaymentCustomers(provider: PaymentProvider, environment: PaymentEnvironment) {
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
    data: customersData,
    isLoading: isLoadingCustomers,
    error: customersError,
    refetch: refetchCustomers,
    isFetching: isFetchingCustomers,
  } = useQuery({
    queryKey: ['payments', 'stripe', 'customers', environment],
    queryFn: () =>
      paymentsService.listCustomers({
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
    queryKey: ['payments', 'razorpay', 'customers', environment],
    queryFn: () =>
      razorpayService.listCustomers({
        environment,
        limit: PAYMENT_CUSTOMERS_LIMIT,
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
    customers: hasActiveKey
      ? isStripeProvider
        ? (customersData?.customers ?? [])
        : (razorpayCustomersData?.customers ?? [])
      : [],
    isLoading:
      (isStripeProvider && (isLoadingStatus || (hasStripeKey && isLoadingCustomers))) ||
      (isRazorpayProvider &&
        (isLoadingRazorpayStatus || (hasRazorpayKey && isLoadingRazorpayCustomers))),
    isRefreshing:
      (isStripeProvider && (isFetchingStatus || (hasStripeKey && isFetchingCustomers))) ||
      (isRazorpayProvider &&
        (isFetchingRazorpayStatus || (hasRazorpayKey && isFetchingRazorpayCustomers))),
    error: isStripeProvider
      ? (statusError ?? customersError)
      : (razorpayStatusError ?? razorpayCustomersError),
    refetch: () =>
      Promise.all([
        isStripeProvider ? refetchStatus() : null,
        isRazorpayProvider ? refetchRazorpayStatus() : null,
        isStripeProvider && hasStripeKey ? refetchCustomers() : null,
        isRazorpayProvider && hasRazorpayKey ? refetchRazorpayCustomers() : null,
      ]),
  };
}
