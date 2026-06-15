import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  StripeEnvironment,
  SyncStripePaymentsEnvironmentResult,
  SyncStripePaymentsRequest,
  SyncStripePaymentsResponse,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { stripeQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '#lib/hooks/useToast';

interface StripeSyncToast {
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

function isFailedSyncResult(result: SyncStripePaymentsEnvironmentResult) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getStripeSyncToast(result: SyncStripePaymentsResponse): StripeSyncToast {
  const attemptedResults = result.results.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const failedResults = attemptedResults.filter(isFailedSyncResult);
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
    message: 'Stripe payments synced successfully.',
  };
}

export function useStripeSync() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const syncPayments = useMutation({
    mutationFn: (input: SyncStripePaymentsRequest) => stripeService.syncPayments(input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.status }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.catalog }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.subscriptions }),
        queryClient.invalidateQueries({ queryKey: stripeQueryKeys.transactions }),
      ]);

      const toast = getStripeSyncToast(result);
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
