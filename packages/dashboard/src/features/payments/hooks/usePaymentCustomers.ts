import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RazorpayConnection, StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { razorpayService } from '#features/payments/services/razorpay.service';

export const PAYMENT_CUSTOMERS_LIMIT = 100;

export function usePaymentCustomers(environment: StripeEnvironment) {
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
    enabled: hasStripeKey,
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
    enabled: hasRazorpayKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    razorpayConnections,
    activeConnection,
    activeRazorpayConnection,
    hasActiveKey,
    customers: hasActiveKey
      ? [...(customersData?.customers ?? []), ...(razorpayCustomersData?.customers ?? [])]
      : [],
    isLoading:
      isLoadingStatus ||
      isLoadingRazorpayStatus ||
      (hasStripeKey && isLoadingCustomers) ||
      (hasRazorpayKey && isLoadingRazorpayCustomers),
    isRefreshing:
      isFetchingStatus ||
      isFetchingRazorpayStatus ||
      (hasStripeKey && isFetchingCustomers) ||
      (hasRazorpayKey && isFetchingRazorpayCustomers),
    error: statusError ?? razorpayStatusError ?? customersError ?? razorpayCustomersError,
    refetch: () =>
      Promise.all([
        refetchStatus(),
        refetchRazorpayStatus(),
        hasStripeKey ? refetchCustomers() : null,
        hasRazorpayKey ? refetchRazorpayCustomers() : null,
      ]),
  };
}
