import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';

export function usePaymentCatalog(environment: StripeEnvironment) {
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
    data: catalogData,
    isLoading: isLoadingCatalog,
    error: catalogError,
    refetch: refetchCatalog,
    isFetching: isFetchingCatalog,
  } = useQuery({
    queryKey: ['payments', 'catalog', environment],
    queryFn: () => paymentsService.listCatalog(environment),
    enabled: hasActiveKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    activeConnection,
    products: hasActiveKey ? (catalogData?.products ?? []) : [],
    prices: hasActiveKey ? (catalogData?.prices ?? []) : [],
    isLoading: isLoadingStatus || (hasActiveKey && isLoadingCatalog),
    isRefreshing: isFetchingStatus || (hasActiveKey && isFetchingCatalog),
    error: statusError ?? catalogError,
    refetch: () => Promise.all([refetchStatus(), hasActiveKey ? refetchCatalog() : null]),
  };
}
