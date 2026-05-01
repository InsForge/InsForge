import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { posthogApi, type Breakdown } from '../services/posthog.api';

export function useWebStats(breakdown: Breakdown, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'web-stats', breakdown, timeframe],
    queryFn: () => posthogApi.getWebStats(breakdown, timeframe),
    enabled,
    staleTime: 60_000,
  });
}
