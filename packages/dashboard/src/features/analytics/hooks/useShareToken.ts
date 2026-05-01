import { useQuery } from '@tanstack/react-query';
import { posthogApi } from '../services/posthog.api';

/** Lazy: only fetches when `enabled` flips true (e.g. modal opens). */
export function useShareToken(recordingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['posthog', 'share-token', recordingId],
    queryFn: () => {
      if (!recordingId) {
        throw new Error('recordingId is required');
      }
      return posthogApi.createRecordingShare(recordingId);
    },
    enabled: enabled && !!recordingId,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
  });
}
