import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { useToast } from '../../../lib/hooks/useToast';
import type { StripeEnvironment } from '@insforge/shared-schemas';

const SUBSCRIPTIONS_LIMIT = 100;

export function usePaymentSubscriptions(environment: StripeEnvironment) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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
    data: subscriptionsData,
    isLoading: isLoadingSubscriptions,
    error: subscriptionsError,
    refetch: refetchSubscriptions,
    isFetching: isFetchingSubscriptions,
  } = useQuery({
    queryKey: ['payments', 'subscriptions', environment],
    queryFn: () =>
      paymentsService.listSubscriptions({
        environment,
        limit: SUBSCRIPTIONS_LIMIT,
      }),
    enabled: hasActiveKey,
    staleTime: 30 * 1000,
  });

  const syncMutation = useMutation({
    mutationFn: () => paymentsService.syncSubscriptions({ environment }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['payments', 'subscriptions'] });
      const unmappedSuffix = result.unmapped > 0 ? ` (${result.unmapped} unmapped)` : '';
      showToast(`Synced ${result.synced} Stripe subscriptions${unmappedSuffix}`, 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to sync Stripe subscriptions', 'error');
    },
  });

  return {
    connections,
    activeConnection,
    subscriptions: subscriptionsData?.subscriptions ?? [],
    isLoading: isLoadingStatus || (hasActiveKey && isLoadingSubscriptions),
    isRefreshing: isFetchingStatus || (hasActiveKey && isFetchingSubscriptions),
    isSyncing: syncMutation.isPending,
    error: statusError ?? subscriptionsError,
    syncSubscriptions: () => syncMutation.mutateAsync(),
    refetch: () => Promise.all([refetchStatus(), hasActiveKey ? refetchSubscriptions() : null]),
  };
}
