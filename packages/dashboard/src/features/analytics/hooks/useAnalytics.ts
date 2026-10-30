import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PosthogRegion, PosthogTimeframe } from '@insforge/shared-schemas';
import {
  analyticsService,
  type Breakdown,
  type TrendMetric,
} from '#features/analytics/services/analytics.service';

export const analyticsQueryKeys = {
  all: ['analytics'] as const,
  connection: ['analytics', 'connection'] as const,
  webOverview: (timeframe: PosthogTimeframe) => ['analytics', 'web-overview', timeframe] as const,
  webStats: (breakdown: Breakdown, timeframe: PosthogTimeframe) =>
    ['analytics', 'web-stats', breakdown, timeframe] as const,
  trend: (metric: TrendMetric, timeframe: PosthogTimeframe) =>
    ['analytics', 'trend', metric, timeframe] as const,
  retention: ['analytics', 'retention'] as const,
  recordings: (limit: number) => ['analytics', 'recordings', limit] as const,
  // Top-level key sits outside the `['analytics', ...]` namespace so the
  // broad `invalidateQueries({ queryKey: analyticsQueryKeys.all })` calls on
  // connect / disconnect don't re-fire this POST and mint duplicate tokens.
  shareToken: (recordingId: string | null) => ['analytics-share-token', recordingId] as const,
};

export function useAnalyticsConnection() {
  return useQuery({
    queryKey: analyticsQueryKeys.connection,
    queryFn: () => analyticsService.getConnection(),
    staleTime: 30_000,
  });
}

export function useWebOverview(timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.webOverview(timeframe),
    queryFn: () => analyticsService.getWebOverview(timeframe),
    enabled,
    staleTime: 60_000,
  });
}

export function useWebStats(breakdown: Breakdown, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.webStats(breakdown, timeframe),
    queryFn: () => analyticsService.getWebStats(breakdown, timeframe),
    enabled,
    staleTime: 60_000,
  });
}

export function useTrend(metric: TrendMetric, timeframe: PosthogTimeframe, enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.trend(metric, timeframe),
    queryFn: () => analyticsService.getTrend(metric, timeframe),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Retention is decoupled from the page timeframe selector — it always returns
 * weekly cohorts (matches PostHog's default Web Analytics retention view).
 */
export function useRetention(enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.retention,
    queryFn: () => analyticsService.getRetention(),
    enabled,
    staleTime: 60_000,
  });
}

export function useRecordings(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.recordings(limit),
    queryFn: () => analyticsService.getRecordings(limit),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Lazy: only fetches when `enabled` flips true (e.g. modal opens).
 *
 * `analyticsService.createRecordingShare` is a POST that mints a new token, so we
 * disable retries / refocus / reconnect refetches to avoid creating duplicate
 * tokens on transient errors or tab focus changes.
 */
export function useShareToken(recordingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: analyticsQueryKeys.shareToken(recordingId),
    queryFn: () => {
      if (!recordingId) {
        throw new Error('recordingId is required');
      }
      return analyticsService.createRecordingShare(recordingId);
    },
    enabled: enabled && !!recordingId,
    // PostHog share tokens persist server-side; keep the cached token for
    // 30min so reopening a modal doesn't mint a fresh one every 5min.
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}

// Self-hosting only. Lists the PostHog projects a candidate key can see so the
// connect form can offer a picker instead of asking for a numeric id. A
// mutation rather than a query: it is driven by a submit, takes the key as
// input, and must never be cached or refetched — the key is a credential.
export function useListPosthogProjects() {
  return useMutation({
    mutationFn: (input: { personalApiKey: string; region: PosthogRegion }) =>
      analyticsService.listPosthogProjects(input.personalApiKey, input.region),
  });
}

export function useUpdatePosthogConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      personalApiKey: string;
      region: PosthogRegion;
      posthogProjectId?: string;
    }) => analyticsService.updatePosthogConfig(input),
    onSuccess: () => {
      // Every analytics panel is derived from the stored credential, not just
      // the connection — invalidating the connection alone would leave the
      // traffic/retention/replay queries serving the previous project's data
      // for their staleTime.
      void queryClient.invalidateQueries({ queryKey: analyticsQueryKeys.all });
    },
  });
}
