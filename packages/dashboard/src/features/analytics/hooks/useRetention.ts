import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '#features/analytics/services/analytics.service';

/**
 * Retention is decoupled from the page timeframe selector — it always returns
 * weekly cohorts (matches PostHog's default Web Analytics retention view).
 */
export function useRetention(enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'retention'],
    queryFn: () => analyticsService.getRetention(),
    enabled,
    staleTime: 60_000,
  });
}
