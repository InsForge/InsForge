import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import {
  razorpayService,
  type GetRazorpayStatusResponse,
} from '#features/payments/services/razorpay.service';
import { razorpayQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '#lib/hooks/useToast';

export function useRazorpayWebhook() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetRazorpayStatusResponse>({
    queryKey: razorpayQueryKeys.status,
    queryFn: () => razorpayService.getStatus(),
    staleTime: 30 * 1000,
  });

  const rotateWebhookSecret = useMutation({
    mutationFn: (environment: RazorpayEnvironment) =>
      razorpayService.rotateWebhookSecret(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.status });
      await queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.all });
      showToast('Razorpay webhook secret rotated', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to rotate Razorpay webhook secret', 'error');
    },
  });

  return {
    connections: data?.razorpayConnections ?? [],
    isLoading,
    error,
    rotateWebhookSecret,
  };
}

export function useRazorpayWebhookSetup(environment: RazorpayEnvironment, enabled: boolean) {
  return useQuery({
    queryKey: razorpayQueryKeys.webhookSetup(environment),
    queryFn: () => razorpayService.getWebhookSetup(environment),
    enabled,
    staleTime: 30 * 1000,
  });
}
