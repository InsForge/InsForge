import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { analyticsService } from '#features/analytics/services/analytics.service';

export function useWebOverview(timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'web-overview', timeframe],
    queryFn: () => analyticsService.getWebOverview(timeframe),
    enabled,
    staleTime: 60_000,
  });
}
