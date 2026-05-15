import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '#features/analytics/services/posthog.api';

export function usePosthogConnection() {
  return useQuery({
    queryKey: ['posthog', 'connection'],
    queryFn: () => posthogApi.getConnection(),
    staleTime: 30_000,
  });
}
