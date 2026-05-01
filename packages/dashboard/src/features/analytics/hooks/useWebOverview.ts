import { useQuery } from '@tanstack/react-query';
import type { PosthogTimeframe } from '@insforge/shared-schemas';
import { posthogApi } from '../services/posthog.api';

export function useWebOverview(timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'web-overview', timeframe],
    queryFn: () => posthogApi.getWebOverview(timeframe),
    enabled,
    staleTime: 60_000,
  });
}
