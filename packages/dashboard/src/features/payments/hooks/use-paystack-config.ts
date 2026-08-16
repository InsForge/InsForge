import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaystackEnvironment } from '@insforge/shared-schemas';
import {
  paystackService,
  type GetPaystackConfigResponse,
  type UpsertPaystackConfigRequest,
} from '#features/payments/services/paystack.service';
import { paystackQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '@insforge/ui';

export function usePaystackConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetPaystackConfigResponse>({
    queryKey: paystackQueryKeys.config,
    queryFn: () => paystackService.getConfig(),
    staleTime: 30 * 1000,
  });

  const saveKey = useMutation({
    mutationFn: (input: UpsertPaystackConfigRequest) => paystackService.upsertConfig(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paystackQueryKeys.all });
      showToast('Paystack keys saved successfully', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save Paystack keys', 'error');
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: PaystackEnvironment) => paystackService.removeConfig(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: paystackQueryKeys.all });
      showToast('Paystack keys removed', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to remove Paystack keys', 'error');
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
