import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GetStripeConfigResponse,
  StripeEnvironment,
  UpsertStripeConfigRequest,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { stripeQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '#lib/hooks/useToast';

// Every data view that depends on the configured key set; invalidated together
// whenever a key is saved or removed.
const STRIPE_CONFIG_DEPENDENT_KEYS = [
  stripeQueryKeys.config,
  stripeQueryKeys.status,
  stripeQueryKeys.catalog,
  stripeQueryKeys.customers,
  stripeQueryKeys.subscriptions,
  stripeQueryKeys.transactions,
];

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
      await Promise.all(
        STRIPE_CONFIG_DEPENDENT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      );
      showToast('Stripe key saved successfully', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save Stripe key', 'error');
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: StripeEnvironment) => stripeService.removeConfig(environment),
    onSuccess: async () => {
      await Promise.all(
        STRIPE_CONFIG_DEPENDENT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      );
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
