import { useMutation } from '@tanstack/react-query';
import {
  advisorService,
  type AdvisorScanResult,
} from '#features/database/services/advisor.service';
import { useToast } from '#lib/hooks/useToast';

export function useAdvisorScan() {
  const { showToast } = useToast();

  const mutation = useMutation<AdvisorScanResult, Error>({
    mutationFn: () => advisorService.runScan(),
    onSuccess: (result) => {
      if (result.errors.length > 0) {
        showToast('Advisor scan completed with some rule errors', 'warn');
        return;
      }

      showToast('Advisor scan completed', 'success');
    },
    onError: (error) => {
      showToast(error.message || 'Advisor scan failed', 'error');
    },
  });

  return {
    runScan: mutation.mutate,
    runScanAsync: mutation.mutateAsync,
    isScanning: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    result: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
  };
}
