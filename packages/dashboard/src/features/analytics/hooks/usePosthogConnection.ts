import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

export function usePosthogConnection() {
  return useQuery({
    queryKey: ['posthog', 'connection'],
    queryFn: () => posthogApi.getConnection(),
    staleTime: 30_000,
  });
}
