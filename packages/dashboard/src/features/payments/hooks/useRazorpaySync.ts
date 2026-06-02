import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RazorpayEnvironment } from '@insforge/shared-schemas';
import {
  razorpayService,
  type SyncRazorpayPaymentsMultiResponse,
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

function isMultiResponse(
  result: SyncRazorpayPaymentsResponse | SyncRazorpayPaymentsMultiResponse
): result is SyncRazorpayPaymentsMultiResponse {
  return 'results' in result;
}

function isFailedSyncResult(result: SyncRazorpayPaymentsResponse) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getRazorpaySyncToast(
  result: SyncRazorpayPaymentsResponse | SyncRazorpayPaymentsMultiResponse
) {
  // Normalise to a flat list of individual results
  let singleResults: SyncRazorpayPaymentsResponse[];
  let apiFailedEnvironments: RazorpayEnvironment[] = [];

  if (isMultiResponse(result)) {
    singleResults = result.results
      .filter(
        (r): r is typeof r & { status: 'fulfilled'; value: SyncRazorpayPaymentsResponse } =>
          r.status === 'fulfilled'
      )
      .map((r) => r.value);

    apiFailedEnvironments = result.results
      .filter((r) => r.status === 'rejected')
      .map((r) => r.environment);
  } else {
    singleResults = [result];
  }

  const attemptedResults = singleResults.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const syncFailedResults = attemptedResults.filter(isFailedSyncResult);
  const syncFailedEnvironments = syncFailedResults.map((item) => item.connection.environment);

  const allFailedEnvironments = [...apiFailedEnvironments, ...syncFailedEnvironments];

  if (attemptedResults.length === 0 && apiFailedEnvironments.length === 0) {
    return {
      type: 'info' as const,
      message: 'No configured Razorpay environments to sync.',
    };
  }

  if (allFailedEnvironments.length > 0) {
    return {
      type: 'error' as const,
      message: `Razorpay sync failed for ${formatEnvironments(allFailedEnvironments)}.`,
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
