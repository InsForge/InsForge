import { useStorageBuckets } from './useStorageBuckets';
import { useStorageObjects } from './useStorageObjects';

export function useStorage() {
  const bucketHook = useStorageBuckets();
  const objectHook = useStorageObjects();
  return { ...bucketHook, ...objectHook };
}

export { useStorageBuckets } from './useStorageBuckets';
export { useStorageObjects } from './useStorageObjects';
