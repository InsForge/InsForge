import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

/**
 * Retention is decoupled from the page timeframe selector — it always returns
 * weekly cohorts (matches PostHog's default Web Analytics retention view).
 */
export function useRetention(enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'retention'],
    queryFn: () => posthogApi.getRetention(),
    enabled,
    staleTime: 60_000,
  });
}
