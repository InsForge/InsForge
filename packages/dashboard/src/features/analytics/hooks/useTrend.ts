import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { posthogApi, type TrendMetric } from '../services/posthog.api';

export function useTrend(metric: TrendMetric, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'trend', metric, timeframe],
    queryFn: () => posthogApi.getTrend(metric, timeframe),
    enabled,
    staleTime: 60_000,
  });
}
