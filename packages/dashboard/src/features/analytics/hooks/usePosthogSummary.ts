import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

export function usePosthogSummary(enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'summary'],
    queryFn: () => posthogApi.getSummary(),
    enabled,
    staleTime: 30_000,
  });
}
