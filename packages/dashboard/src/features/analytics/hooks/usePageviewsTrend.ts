import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { posthogApi } from '../services/posthog.api';

export function usePageviewsTrend(timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'pageviews-trend', timeframe],
    queryFn: () => posthogApi.getPageviewsTrend(timeframe),
    enabled,
    staleTime: 60_000,
  });
}
