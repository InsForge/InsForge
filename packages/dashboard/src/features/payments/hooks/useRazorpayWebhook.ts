import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import {
  razorpayService,
  type GetRazorpayStatusResponse,
} from '#features/payments/services/razorpay.service';
import { useToast } from '#lib/hooks/useToast';

const RAZORPAY_STATUS_QUERY_KEY = ['payments', 'razorpay', 'status'];

export function useRazorpayWebhook() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetRazorpayStatusResponse>({
    queryKey: RAZORPAY_STATUS_QUERY_KEY,
    queryFn: () => razorpayService.getStatus(),
    staleTime: 30 * 1000,
  });

  const configureWebhook = useMutation({
    mutationFn: (environment: RazorpayEnvironment) => razorpayService.configureWebhook(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RAZORPAY_STATUS_QUERY_KEY });
      showToast('Razorpay webhook setup values generated', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to configure Razorpay webhook', 'error');
    },
  });

  return {
    connections: data?.razorpayConnections ?? [],
    isLoading,
    error,
    configureWebhook,
  };
}
