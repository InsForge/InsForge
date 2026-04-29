import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

export function usePosthogEvents(enabled: boolean, limit = 10) {
  return useQuery({
    queryKey: ['posthog', 'events', limit],
    queryFn: () => posthogApi.getRecentEvents(limit),
    enabled,
    staleTime: 15_000,
  });
}
