import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import { razorpayService, type SyncRazorpayPaymentsRequest, type SyncRazorpayPaymentsResponse } from '#features/payments/services/razorpay.service';
import { useToast } from '#lib/hooks/useToast';

const ENVIRONMENT_LABEL: Record<RazorpayEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

function formatEnvironments(environments: RazorpayEnvironment[]) {
  return environments.map((environment) => ENVIRONMENT_LABEL[environment]).join(', ');
}

function isFailedSyncResult(result: SyncRazorpayPaymentsResponse) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getRazorpaySyncToast(result: SyncRazorpayPaymentsResponse | SyncRazorpayPaymentsResponse[]) {
  const results = Array.isArray(result) ? result : [result];
  const attemptedResults = results.filter((item) => item.connection.status !== 'unconfigured');
  const failedResults = attemptedResults.filter(isFailedSyncResult);
  const failedEnvironments = failedResults.map((item) => item.connection.environment);

  if (attemptedResults.length === 0) {
    return {
      type: 'info' as const,
      message: 'No configured Razorpay environments to sync.',
    };
  }

  if (failedResults.length > 0) {
    return {
      type: 'error' as const,
      message: `Razorpay sync failed for ${formatEnvironments(failedEnvironments)}.`,
    };
  }

  return {
    type: 'success' as const,
    message: 'Razorpay payments synced successfully.',
  };
}

export function useRazorpaySync() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const syncPayments = useMutation({
    mutationFn: (input: SyncRazorpayPaymentsRequest) => razorpayService.syncPayments(input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'catalog'] }),
      ]);

      const toast = getRazorpaySyncToast(result);
      showToast(toast.message, toast.type);
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to sync Razorpay payments', 'error');
    },
  });

  return {
    syncPayments,
  };
}
