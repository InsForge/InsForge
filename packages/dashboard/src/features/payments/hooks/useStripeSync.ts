import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  StripeEnvironment,
  SyncStripePaymentsEnvironmentResult,
  SyncStripePaymentsRequest,
  SyncStripePaymentsResponse,
} from '@insforge/shared-schemas';
import { stripeService } from '#features/payments/services/stripe.service';
import { stripeQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '@insforge/ui';

interface StripeSyncToast {
  type: 'success' | 'error' | 'info';
  message: string;
}

function formatEnvironments(environments: StripeEnvironment[], t: TFunction<'chrome'>) {
  return environments
    .map((environment) =>
      environment === 'test'
        ? t('payments.modeTest', { defaultValue: 'Test' })
        : t('payments.modeLive', { defaultValue: 'Live' })
    )
    .join(', ');
}

function isFailedSyncResult(result: SyncStripePaymentsEnvironmentResult) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getStripeSyncToast(
  result: SyncStripePaymentsResponse,
  t: TFunction<'chrome'>
): StripeSyncToast {
  const attemptedResults = result.results.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const failedResults = attemptedResults.filter(isFailedSyncResult);
  const failedEnvironments = failedResults.map((item) => item.environment);

  if (attemptedResults.length === 0) {
    return {
      type: 'info',
      message: t('payments.noStripeEnvironmentsToSync', {
        defaultValue: 'No configured Stripe environments to sync.',
      }),
    };
  }

  if (failedResults.length > 0) {
    return {
      type: 'error',
      message: t('payments.stripeSyncFailedFor', {
        defaultValue: 'Stripe sync failed for {{environments}}.',
        environments: formatEnvironments(failedEnvironments, t),
      }),
    };
  }

  return {
    type: 'success',
    message: t('payments.stripePaymentsSynced', {
      defaultValue: 'Stripe payments synced successfully.',
    }),
  };
}

export function useStripeSync() {
  const { t } = useTranslation('chrome');
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

      const toast = getStripeSyncToast(result, t);
      showToast(toast.message, toast.type);
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('payments.syncStripeFailed', { defaultValue: 'Failed to sync Stripe payments' }),
        'error'
      );
    },
  });

  return {
    syncPayments,
  };
}
