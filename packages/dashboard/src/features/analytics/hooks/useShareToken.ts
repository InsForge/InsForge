import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '#features/analytics/services/posthog.api';

/**
 * Lazy: only fetches when `enabled` flips true (e.g. modal opens).
 *
 * `posthogApi.createRecordingShare` is a POST that mints a new token, so we
 * disable retries / refocus / reconnect refetches to avoid creating duplicate
 * tokens on transient errors or tab focus changes.
 */
export function useShareToken(recordingId: string | null, enabled: boolean) {
  return useQuery({
    // Top-level key sits outside the `['posthog', ...]` namespace so the
    // broad `invalidateQueries({ queryKey: ['posthog'] })` calls on
    // connect / disconnect don't re-fire this POST and mint duplicate tokens.
    queryKey: ['posthog-share-token', recordingId],
    queryFn: () => {
      if (!recordingId) {
        throw new Error('recordingId is required');
      }
      return posthogApi.createRecordingShare(recordingId);
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
