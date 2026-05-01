import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import type { StripeEnvironment } from '@insforge/shared-schemas';

const SUBSCRIPTIONS_LIMIT = 100;

export function usePaymentSubscriptions(environment: StripeEnvironment) {
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

  return {
    connections,
    activeConnection,
    subscriptions: subscriptionsData?.subscriptions ?? [],
    isLoading: isLoadingStatus || (hasActiveKey && isLoadingSubscriptions),
    isRefreshing: isFetchingStatus || (hasActiveKey && isFetchingSubscriptions),
    error: statusError ?? subscriptionsError,
    refetch: () => Promise.all([refetchStatus(), hasActiveKey ? refetchSubscriptions() : null]),
  };
}
