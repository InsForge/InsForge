import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { useToast } from '../../../lib/hooks/useToast';
import type { StripeEnvironment } from '@insforge/shared-schemas';

export function usePayments(environment: StripeEnvironment) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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

  const syncMutation = useMutation({
    mutationFn: () => paymentsService.syncCatalog(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'catalog'] }),
      ]);
      showToast('Stripe catalogs synced successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to sync Stripe catalog', 'error');
    },
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
    isSyncing: syncMutation.isPending,
    error: statusError ?? catalogError,
    syncCatalog: () => syncMutation.mutateAsync(),
    refetch: () => Promise.all([refetchStatus(), refetchCatalog()]),
  };
}
