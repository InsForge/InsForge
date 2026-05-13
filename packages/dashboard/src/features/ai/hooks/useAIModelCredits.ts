import { useQuery } from '@tanstack/react-query';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import type { DashboardModelCreditUsage } from '#types';

export function useAIModelCredits() {
  const host = useDashboardHost();
  const canRequestModelCredits = host.mode === 'cloud-hosting' && !!host.onRequestModelCredits;

  return useQuery<DashboardModelCreditUsage>({
    queryKey: ['ai-model-credits', host.mode],
    queryFn: () => {
      if (!host.onRequestModelCredits) {
        throw new Error('Model credit usage is only available in cloud-hosting mode.');
      }

      return host.onRequestModelCredits();
    },
    enabled: canRequestModelCredits,
    staleTime: 60 * 1000,
    retry: false,
  });
}
