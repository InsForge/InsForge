import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { analyticsService, type Breakdown } from '#features/analytics/services/analytics.service';

export function useWebStats(breakdown: Breakdown, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'web-stats', breakdown, timeframe],
    queryFn: () => analyticsService.getWebStats(breakdown, timeframe),
    enabled,
    staleTime: 60_000,
  });
}
