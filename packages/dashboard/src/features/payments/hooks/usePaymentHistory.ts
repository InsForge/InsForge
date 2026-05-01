import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import type { StripeEnvironment } from '@insforge/shared-schemas';

const PAYMENT_HISTORY_LIMIT = 100;

export function usePaymentHistory(environment: StripeEnvironment) {
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
    data: paymentHistoryData,
    isLoading: isLoadingPaymentHistory,
    error: paymentHistoryError,
    refetch: refetchPaymentHistory,
    isFetching: isFetchingPaymentHistory,
  } = useQuery({
    queryKey: ['payments', 'payment-history', environment],
    queryFn: () =>
      paymentsService.listPaymentHistory({
        environment,
        limit: PAYMENT_HISTORY_LIMIT,
      }),
    enabled: hasActiveKey,
    staleTime: 30 * 1000,
  });

  return {
    connections,
    activeConnection,
    paymentHistory: paymentHistoryData?.paymentHistory ?? [],
    isLoading: isLoadingStatus || (hasActiveKey && isLoadingPaymentHistory),
    isRefreshing: isFetchingStatus || (hasActiveKey && isFetchingPaymentHistory),
    error: statusError ?? paymentHistoryError,
    refetch: () => Promise.all([refetchStatus(), hasActiveKey ? refetchPaymentHistory() : null]),
  };
}
