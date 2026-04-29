import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

export function usePosthogDashboards(enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'dashboards'],
    queryFn: () => posthogApi.getDashboards(),
    enabled,
    staleTime: 60_000,
  });
}
