import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '#features/analytics/services/analytics.service';

export function usePosthogConnection() {
  return useQuery({
    queryKey: ['posthog', 'connection'],
    queryFn: () => analyticsService.getConnection(),
    staleTime: 30_000,
  });
}
