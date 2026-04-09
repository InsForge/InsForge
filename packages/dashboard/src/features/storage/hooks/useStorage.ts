import { useStorageBuckets } from './useStorageBuckets';
import { useStorageObjects } from './useStorageObjects';

/**
 * Backward-compatible facade that composes useStorageBuckets and useStorageObjects.
 * Prefer importing the specific hooks directly for narrower dependency scope.
 */
export function useStorage() {
  const bucketHook = useStorageBuckets();
  const objectHook = useStorageObjects();

  return {
    ...bucketHook,
    ...objectHook,
    // Wrap useBucketStats to preserve the original (buckets, enabled) => ... signature
    // where buckets is sourced from the bucket hook internally
    useBucketStats: (enabled = true) => objectHook.useBucketStats(bucketHook.buckets, enabled),
  };
}
