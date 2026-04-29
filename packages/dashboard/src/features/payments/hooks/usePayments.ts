import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import type { StripeEnvironment } from '@insforge/shared-schemas';

export function usePayments(environment: StripeEnvironment) {
  const {
    data: statusData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['payments', 'status'],
    queryFn: () => paymentsService.getStatus(),
    staleTime: 30 * 1000,
  });

  const {
    data: catalogData,
    isLoading: isLoadingCatalog,
    error: catalogError,
    refetch: refetchCatalog,
  } = useQuery({
    queryKey: ['payments', 'catalog', environment],
    queryFn: () => paymentsService.listCatalog(environment),
    staleTime: 30 * 1000,
  });

  const connections = useMemo(() => statusData?.connections ?? [], [statusData]);
  const activeConnection = useMemo(
    () => connections.find((connection) => connection.environment === environment) ?? null,
    [connections, environment]
  );

  return {
    connections,
    activeConnection,
    products: catalogData?.products ?? [],
    prices: catalogData?.prices ?? [],
    isLoading: isLoadingStatus || isLoadingCatalog,
    error: statusError ?? catalogError,
    refetch: () => Promise.all([refetchStatus(), refetchCatalog()]),
  };
}
