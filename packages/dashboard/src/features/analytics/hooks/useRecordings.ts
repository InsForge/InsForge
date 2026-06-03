import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '#features/analytics/services/analytics.service';

export function useRecordings(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'recordings', limit],
    queryFn: () => analyticsService.getRecordings(limit),
    enabled,
    staleTime: 60_000,
  });
}
