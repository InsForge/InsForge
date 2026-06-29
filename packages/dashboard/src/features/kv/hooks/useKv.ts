import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { kvService } from '#features/kv/services/kv.service';
import { useToast } from '#lib/hooks/useToast';
import type { KvSetRequest } from '@insforge/shared-schemas';

export const KV_KEYS_QUERY_KEY = 'kv-keys';

export function useKvKeys(namespace: string) {
  return useQuery({
    queryKey: [KV_KEYS_QUERY_KEY, namespace],
    queryFn: () => kvService.listKeys(namespace),
    // Skip the request when there is no namespace (e.g. the input was cleared).
    enabled: namespace.length > 0,
    staleTime: 30 * 1000,
    retry: false,
  });
}

export function useSetKvEntry(namespace: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ key, input }: { key: string; input: KvSetRequest }) =>
      kvService.setValue(namespace, key, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KV_KEYS_QUERY_KEY, namespace] });
      showToast('Key saved', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to save key', 'error');
    },
  });
}

export function useDeleteKvEntry(namespace: string) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (key: string) => kvService.deleteKey(namespace, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [KV_KEYS_QUERY_KEY, namespace] });
      showToast('Key deleted', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete key', 'error');
    },
  });
}
