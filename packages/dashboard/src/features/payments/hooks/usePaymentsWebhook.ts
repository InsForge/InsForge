import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetPaymentsStatusResponse, StripeEnvironment } from '@insforge/shared-schemas';
import { paymentsService } from '#features/payments/services/payments.service';
import { useToast } from '#lib/hooks/useToast';

const PAYMENTS_STATUS_QUERY_KEY = ['payments', 'status'];

export function usePaymentsWebhook() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetPaymentsStatusResponse>({
    queryKey: PAYMENTS_STATUS_QUERY_KEY,
    queryFn: () => paymentsService.getStatus(),
    staleTime: 30 * 1000,
  });

  const configureWebhook = useMutation({
    mutationFn: (environment: StripeEnvironment) => paymentsService.configureWebhook(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PAYMENTS_STATUS_QUERY_KEY });
      showToast('Stripe webhook configured', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to configure Stripe webhook', 'error');
    },
  });

  return {
    connections: data?.connections ?? [],
    isLoading,
    error,
    configureWebhook,
  };
}
