import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '#features/analytics/services/analytics.service';

export function usePosthogDashboards(enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'dashboards'],
    queryFn: () => analyticsService.getDashboards(),
    enabled,
    staleTime: 60_000,
  });
}
