import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  RazorpayEnvironment,
  SyncRazorpayPaymentsEnvironmentResult,
} from '@insforge/shared-schemas';
import {
  razorpayService,
  type SyncRazorpayPaymentsRequest,
  type SyncRazorpayPaymentsResponse,
} from '#features/payments/services/razorpay.service';
import { razorpayQueryKeys } from '#features/payments/queryKeys';
import { useToast } from '@insforge/ui';

function formatEnvironments(environments: RazorpayEnvironment[], t: TFunction<'chrome'>) {
  return environments
    .map((environment) =>
      environment === 'test'
        ? t('payments.modeTest', { defaultValue: 'Test' })
        : t('payments.modeLive', { defaultValue: 'Live' })
    )
    .join(', ');
}

function isFailedSyncResult(result: SyncRazorpayPaymentsEnvironmentResult) {
  return result.connection.status === 'error' || result.connection.lastSyncStatus === 'failed';
}

function getRazorpaySyncToast(result: SyncRazorpayPaymentsResponse, t: TFunction<'chrome'>) {
  const attemptedResults = result.results.filter(
    (item) => item.connection.status !== 'unconfigured'
  );
  const syncFailedResults = attemptedResults.filter(isFailedSyncResult);
  const syncFailedEnvironments = syncFailedResults.map((item) => item.connection.environment);

  if (attemptedResults.length === 0) {
    return {
      type: 'info' as const,
      message: t('payments.noRazorpayEnvironmentsToSync', {
        defaultValue: 'No configured Razorpay environments to sync.',
      }),
    };
  }

  if (syncFailedEnvironments.length > 0) {
    return {
      type: 'error' as const,
      message: t('payments.razorpaySyncFailedFor', {
        defaultValue: 'Razorpay sync failed for {{environments}}.',
        environments: formatEnvironments(syncFailedEnvironments, t),
      }),
    };
  }

  return {
    type: 'success' as const,
    message: t('payments.razorpayPaymentsSynced', {
      defaultValue: 'Razorpay payments synced successfully.',
    }),
  };
}

export function useRazorpaySync() {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const syncPayments = useMutation({
    mutationFn: (input: SyncRazorpayPaymentsRequest) => razorpayService.syncPayments(input),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.status }),
        queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.catalog }),
        queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.customers }),
        queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.subscriptions }),
        queryClient.invalidateQueries({ queryKey: razorpayQueryKeys.transactions }),
      ]);

      const toast = getRazorpaySyncToast(result, t);
      showToast(toast.message, toast.type);
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('payments.syncRazorpayFailed', { defaultValue: 'Failed to sync Razorpay payments' }),
        'error'
      );
    },
  });

  return {
    syncPayments,
  };
}
