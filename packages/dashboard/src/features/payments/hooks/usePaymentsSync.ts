import { useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { useToast } from '../../../lib/hooks/useToast';
import type { SyncPaymentsRequest } from '@insforge/shared-schemas';

export function usePaymentsSync() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const syncPayments = useMutation({
    mutationFn: (input: SyncPaymentsRequest) => paymentsService.syncPayments(input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'subscriptions'] }),
      ]);

      const syncedSubscriptions = result.results.reduce(
        (count, item) => count + (item.subscriptions?.synced ?? 0),
        0
      );
      showToast(`Stripe payments synced (${syncedSubscriptions} subscriptions)`, 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to sync Stripe payments', 'error');
    },
  });

  return {
    syncPayments,
  };
}
