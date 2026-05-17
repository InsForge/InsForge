import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  advisorService,
  type AdvisorScanResult,
} from '#features/database/services/advisor.service';
import { useToast } from '#lib/hooks/useToast';

const ADVISOR_LATEST_QUERY_KEY = ['database', 'advisor', 'latest'] as const;

export function useAdvisorLatestScan() {
  return useQuery<AdvisorScanResult | null, Error>({
    queryKey: ADVISOR_LATEST_QUERY_KEY,
    queryFn: () => advisorService.getLatestScan(),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function useAdvisorScan() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation<AdvisorScanResult, Error>({
    mutationFn: () => advisorService.runScan(),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ADVISOR_LATEST_QUERY_KEY });

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
