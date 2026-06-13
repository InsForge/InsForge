import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import {
  razorpayService,
  type GetRazorpayConfigResponse,
  type UpsertRazorpayConfigRequest,
} from '#features/payments/services/razorpay.service';
import { useToast } from '#lib/hooks/useToast';

const RAZORPAY_CONFIG_QUERY_KEY = ['payments', 'razorpay', 'config'];

export function useRazorpayConfig() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetRazorpayConfigResponse>({
    queryKey: RAZORPAY_CONFIG_QUERY_KEY,
    queryFn: () => razorpayService.getConfig(),
    staleTime: 30 * 1000,
  });

  const saveKey = useMutation({
    mutationFn: (input: UpsertRazorpayConfigRequest) => razorpayService.upsertConfig(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay'] });
      showToast('Razorpay keys saved successfully', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to save Razorpay keys', 'error');
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: RazorpayEnvironment) => razorpayService.removeConfig(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay'] });
      showToast('Razorpay keys removed', 'success');
    },
    onError: (err: Error) => {
      showToast(err.message || 'Failed to remove Razorpay keys', 'error');
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
