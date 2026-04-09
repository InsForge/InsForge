import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useStorageBuckets() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: buckets,
    isLoading: isLoadingBuckets,
    error: bucketsError,
    refetch: refetchBuckets,
  } = useQuery({
    queryKey: ['storage', 'buckets'],
    queryFn: () => storageService.listBuckets(),
  });

  const createBucketMutation = useMutation({
    mutationFn: ({ bucketName, isPublic }: { bucketName: string; isPublic: boolean }) =>
      storageService.createBucket(bucketName, isPublic),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
      showToast('Bucket created successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create bucket';
      showToast(errorMessage, 'error');
    },
  });

  const deleteBucketMutation = useMutation({
    mutationFn: (bucketName: string) => storageService.deleteBucket(bucketName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
      showToast('Bucket deleted successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete bucket';
      showToast(errorMessage, 'error');
    },
  });

  const editBucketMutation = useMutation({
    mutationFn: ({ bucketName, config }: { bucketName: string; config: { isPublic: boolean } }) =>
      storageService.editBucket(bucketName, config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage'] });
      showToast('Bucket updated successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update bucket';
      showToast(errorMessage, 'error');
    },
  });

  return {
    buckets: buckets || [],
    bucketsCount: buckets?.length || 0,
    isLoadingBuckets,
    bucketsError,
    refetchBuckets,
    createBucket: createBucketMutation.mutateAsync,
    deleteBucket: deleteBucketMutation.mutateAsync,
    editBucket: editBucketMutation.mutateAsync,
    isCreatingBucket: createBucketMutation.isPending,
    isDeletingBucket: deleteBucketMutation.isPending,
    isEditingBucket: editBucketMutation.isPending,
  };
}
