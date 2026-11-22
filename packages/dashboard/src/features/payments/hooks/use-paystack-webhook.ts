import { useQuery } from '@tanstack/react-query';
import type { PaystackEnvironment } from '@insforge/shared-schemas';
import {
  paystackService,
  type GetPaystackStatusResponse,
} from '#features/payments/services/paystack.service';
import { paystackQueryKeys } from '#features/payments/queryKeys';

export function usePaystackWebhook() {
  const { data, isLoading, error } = useQuery<GetPaystackStatusResponse>({
    queryKey: paystackQueryKeys.status,
    queryFn: () => paystackService.getStatus(),
    staleTime: 30 * 1000,
  });

  return {
    connections: data?.paystackConnections ?? [],
    isLoading,
    error,
  };
}

export function usePaystackWebhookSetup(environment: PaystackEnvironment, enabled: boolean) {
  return useQuery({
    queryKey: paystackQueryKeys.webhookSetup(environment),
    queryFn: () => paystackService.getWebhookSetup(environment),
    enabled,
    staleTime: 30 * 1000,
  });
}
