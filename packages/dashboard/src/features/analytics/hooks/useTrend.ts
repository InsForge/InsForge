import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { analyticsService, type TrendMetric } from '#features/analytics/services/analytics.service';

export function useTrend(metric: TrendMetric, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'trend', metric, timeframe],
    queryFn: () => analyticsService.getTrend(metric, timeframe),
    enabled,
    staleTime: 60_000,
  });
}
