import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

export function useRecordings(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'recordings', limit],
    queryFn: () => posthogApi.getRecordings(limit),
    enabled,
    staleTime: 60_000,
  });
}
