import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import {
  razorpayService,
  type GetRazorpayConfigResponse,
  type UpsertRazorpayConfigRequest,
} from '#features/payments/services/razorpay.service';
import { razorpayQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '@insforge/ui';

export function useRazorpayConfig() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data, isLoading, error } = useQuery<GetRazorpayConfigResponse>({
    queryKey: razorpayQueryKeys.config,
    queryFn: () => razorpayService.getConfig(),
    staleTime: 30 * 1000,
  });

  const saveKey = useMutation({
    mutationFn: (input: UpsertRazorpayConfigRequest) => razorpayService.upsertConfig(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.all });
      showToast(
        t('payments.razorpayKeysSaved', { defaultValue: 'Razorpay keys saved successfully' }),
        'success'
      );
    },
    onError: (err: Error) => {
      showToast(
        err.message ||
          t('payments.saveRazorpayKeysFailed', { defaultValue: 'Failed to save Razorpay keys' }),
        'error'
      );
    },
  });

  const removeKey = useMutation({
    mutationFn: (environment: RazorpayEnvironment) => razorpayService.removeConfig(environment),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.all });
      showToast(
        t('payments.razorpayKeysRemoved', { defaultValue: 'Razorpay keys removed' }),
        'success'
      );
    },
    onError: (err: Error) => {
      showToast(
        err.message ||
          t('payments.removeRazorpayKeysFailed', {
            defaultValue: 'Failed to remove Razorpay keys',
          }),
        'error'
      );
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
