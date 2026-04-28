import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { useToast } from '../../../lib/hooks/useToast';
import type {
  GetPaymentsConfigResponse,
  StripeEnvironment,
  UpsertPaymentsConfigRequest,
} from '@insforge/shared-schemas';

const PAYMENTS_CONFIG_QUERY_KEY = ['payments', 'config'];

export function usePaymentsConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetPaymentsConfigResponse>({
    queryKey: PAYMENTS_CONFIG_QUERY_KEY,
    queryFn: () => paymentsService.getConfig(),
    staleTime: 30 * 1000,
  });

  const saveKey = useMutation({
    mutationFn: (input: UpsertPaymentsConfigRequest) => paymentsService.upsertConfig(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PAYMENTS_CONFIG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'subscriptions'] }),
      ]);
      showToast('Stripe key saved successfully', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save Stripe key', 'error');
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: StripeEnvironment) => paymentsService.removeConfig(environment),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PAYMENTS_CONFIG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'subscriptions'] }),
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
