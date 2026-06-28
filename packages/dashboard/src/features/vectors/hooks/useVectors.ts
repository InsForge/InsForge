import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vectorStoreService } from '#features/vectors/services/vector.service';
import { useToast } from '#lib/hooks/useToast';

export const VECTOR_COLLECTIONS_QUERY_KEY = ['vector-collections'] as const;

export function useCollections() {
  return useQuery({
    queryKey: VECTOR_COLLECTIONS_QUERY_KEY,
    queryFn: () => vectorStoreService.listCollections(),
    staleTime: 30 * 1000,
    retry: false,
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (name: string) => vectorStoreService.createCollection(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VECTOR_COLLECTIONS_QUERY_KEY });
      showToast('Collection created', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to create collection', 'error');
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  return useMutation({
    mutationFn: (name: string) => vectorStoreService.deleteCollection(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: VECTOR_COLLECTIONS_QUERY_KEY });
      showToast('Collection deleted', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to delete collection', 'error');
    },
  });
}

export function useQueryCollection() {
  const { showToast } = useToast();

  return useMutation({
    mutationFn: ({ name, text, topK }: { name: string; text: string; topK: number }) =>
      vectorStoreService.query(name, text, topK),
    onError: (error: Error) => {
      showToast(error.message || 'Query failed', 'error');
    },
  });
}
