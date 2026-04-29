import { useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { useToast } from '../../../lib/hooks/useToast';
import type {
  StripeEnvironment,
  SyncPaymentsEnvironmentResult,
  SyncPaymentsRequest,
  SyncPaymentsResponse,
} from '@insforge/shared-schemas';

interface PaymentsSyncToast {
  type: 'success' | 'error' | 'info';
  message: string;
}

const ENVIRONMENT_LABEL: Record<StripeEnvironment, string> = {
  test: 'Test',
  live: 'Live',
};

function formatEnvironments(environments: StripeEnvironment[]) {
  return environments.map((environment) => ENVIRONMENT_LABEL[environment]).join(', ');
}

function isFailedSyncResult(result: SyncPaymentsEnvironmentResult) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getPaymentsSyncToast(result: SyncPaymentsResponse): PaymentsSyncToast {
  const attemptedResults = result.results.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const failedResults = attemptedResults.filter(isFailedSyncResult);
  const succeededResults = attemptedResults.filter((item) => !isFailedSyncResult(item));
  const syncedSubscriptions = succeededResults.reduce(
    (count, item) => count + (item.subscriptions?.synced ?? 0),
    0
  );

  const failedEnvironments = failedResults.map((item) => item.environment);

  if (attemptedResults.length === 0) {
    return {
      type: 'info',
      message: 'No configured Stripe environments to sync.',
    };
  }

  if (failedResults.length > 0) {
    return {
      type: 'error',
      message: `Stripe sync failed for ${formatEnvironments(failedEnvironments)}.`,
    };
  }

  return {
    type: 'success',
    message: `Stripe payments synced (${syncedSubscriptions} subscriptions).`,
  };
}

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

      const toast = getPaymentsSyncToast(result);
      showToast(toast.message, toast.type);
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to sync Stripe payments', 'error');
    },
  });

  return {
    syncPayments,
  };
}
