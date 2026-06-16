import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetStripeStatusResponse, StripeEnvironment } from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { stripeQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '#lib/hooks/useToast';

export function useStripeWebhook() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetStripeStatusResponse>({
    queryKey: stripeQueryKeys.status,
    queryFn: () => stripeService.getStatus(),
    staleTime: 30 * 1000,
  });

  const configureWebhook = useMutation({
    mutationFn: (environment: StripeEnvironment) => stripeService.configureWebhook(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: stripeQueryKeys.status });
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
