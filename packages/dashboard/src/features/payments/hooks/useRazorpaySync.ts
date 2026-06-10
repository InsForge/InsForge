import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  RazorpayEnvironment,
  SyncRazorpayPaymentsEnvironmentResult,
} from '@insforge/shared-schemas';
import {
  razorpayService,
  type SyncRazorpayPaymentsRequest,
  type SyncRazorpayPaymentsResponse,
} from '#features/payments/services/razorpay.service';
import { useToast } from '#lib/hooks/useToast';

const ENVIRONMENT_LABEL: Record<RazorpayEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

function formatEnvironments(environments: RazorpayEnvironment[]) {
  return environments.map((environment) => ENVIRONMENT_LABEL[environment]).join(', ');
}

function isFailedSyncResult(result: SyncRazorpayPaymentsEnvironmentResult) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getRazorpaySyncToast(result: SyncRazorpayPaymentsResponse) {
  const attemptedResults = result.results.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const syncFailedResults = attemptedResults.filter(isFailedSyncResult);
  const syncFailedEnvironments = syncFailedResults.map((item) => item.connection.environment);

  if (attemptedResults.length === 0) {
    return {
      type: 'info' as const,
      message: 'No configured Razorpay environments to sync.',
    };
  }

  if (syncFailedEnvironments.length > 0) {
    return {
      type: 'error' as const,
      message: `Razorpay sync failed for ${formatEnvironments(syncFailedEnvironments)}.`,
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
        queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay', 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay', 'customers'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay', 'subscriptions'] }),
        queryClient.invalidateQueries({ queryKey: ['payments', 'razorpay', 'transactions'] }),
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
