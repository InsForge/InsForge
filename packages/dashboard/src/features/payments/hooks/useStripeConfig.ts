import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GetStripeConfigResponse,
  StripeEnvironment,
  UpsertStripeConfigRequest,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { stripeQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '#lib/hooks/useToast';

export function useStripeConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetStripeConfigResponse>({
    queryKey: stripeQueryKeys.config,
    queryFn: () => stripeService.getConfig(),
    staleTime: 30 * 1000,
  });

  const saveKey = useMutation({
    mutationFn: (input: UpsertStripeConfigRequest) => stripeService.upsertConfig(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.config }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.status }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.catalog }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.subscriptions }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.transactions }),
      ]);
      showToast('Stripe key saved successfully', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save Stripe key', 'error');
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: StripeEnvironment) => stripeService.removeConfig(environment),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.config }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.status }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.catalog }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.subscriptions }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.transactions }),
      ]);
      showToast('Stripe key removed', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to remove Stripe key', 'error');
    },
  });

  return {
    keys: data?.keys ?? [],
    isLoading,
    error,
    saveKey,
    removeKey,
  };
}
