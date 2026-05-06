import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';

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

  const connections = useMemo(() => statusData?.connections ?? [], [statusData]);
  const activeConnection = useMemo(
    () => connections.find((connection) => connection.environment === environment) ?? null,
    [connections, environment]
  );
  const hasActiveKey = !!activeConnection?.maskedKey;

  const {
    data: customersData,
    isLoading: isLoadingCustomers,
    error: customersError,
    refetch: refetchCustomers,
    isFetching: isFetchingCustomers,
  } = useQuery({
    queryKey: ['payments', 'customers', environment],
    queryFn: () =>
      paymentsService.listCustomers({
        environment,
        limit: PAYMENT_CUSTOMERS_LIMIT,
      }),
    enabled: hasActiveKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    activeConnection,
    customers: customersData?.customers ?? [],
    isLoading: isLoadingStatus || (hasActiveKey && isLoadingCustomers),
    isRefreshing: isFetchingStatus || (hasActiveKey && isFetchingCustomers),
    error: statusError ?? customersError,
    refetch: () => Promise.all([refetchStatus(), hasActiveKey ? refetchCustomers() : null]),
  };
}
