import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useBuckets() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch all buckets
  const {
    data: buckets,
    isLoading: isLoadingBuckets,
    error: bucketsError,
    refetch: refetchBuckets,
  } = useQuery({
    queryKey: ['storage', 'buckets'],
    queryFn: () => storageService.listBuckets(),
  });

  // Query to fetch bucket statistics
  const useBucketStats = (enabled = true) => {
    return useQuery({
      queryKey: ['storage', 'bucket-stats', buckets],
      queryFn: async () => {
        const stats: Record<string, { fileCount: number; public: boolean; createdAt?: string }> =
          {};
        const currentBuckets = buckets || [];
        const promises = currentBuckets.map(async (bucket) => {
          try {
            const result = await storageService.listObjects(bucket.name, { limit: 1 });
            return {
              bucketName: bucket.name,
              stats: {
                fileCount: result.pagination.total,
                public: bucket.public,
                createdAt: bucket.createdAt,
              },
            };
          } catch (error) {
            console.error(`Failed to fetch stats for bucket "${bucket.name}":`, error);
            return {
              bucketName: bucket.name,
              stats: {
                fileCount: 0,
                public: bucket.public,
                createdAt: bucket.createdAt,
              },
            };
          }
        });
        const results = await Promise.all(promises);
        results.forEach((result) => {
          stats[result.bucketName] = result.stats;
        });
        return stats;
      },
      enabled: enabled && (buckets?.length || 0) > 0,
      staleTime: 30000,
    });
  };

  // Mutation to create a bucket
  const createBucketMutation = useMutation({
    mutationFn: ({ bucketName, isPublic }: { bucketName: string; isPublic: boolean }) =>
      storageService.createBucket(bucketName, isPublic),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
      showToast('Bucket created successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message ?? 'Failed to create bucket', 'error');
    },
  });

  // Mutation to delete a bucket
  const deleteBucketMutation = useMutation({
    mutationFn: (bucketName: string) => storageService.deleteBucket(bucketName),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
      showToast('Bucket deleted successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message ?? 'Failed to delete bucket', 'error');
    },
  });

  // Mutation to edit a bucket
  const editBucketMutation = useMutation({
    mutationFn: ({ bucketName, config }: { bucketName: string; config: { isPublic: boolean } }) =>
      storageService.editBucket(bucketName, config),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage', 'buckets'] });
      showToast('Bucket updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message ?? 'Failed to update bucket', 'error');
    },
  });

  return {
    // Data
    buckets: buckets || [],
    bucketsCount: buckets?.length || 0,

    // Loading states
    isLoadingBuckets,
    isCreatingBucket: createBucketMutation.isPending,
    isEditingBucket: editBucketMutation.isPending,
    isDeletingBucket: deleteBucketMutation.isPending,

    // Errors
    bucketsError,

    // Actions
    createBucket: createBucketMutation.mutateAsync,
    editBucket: editBucketMutation.mutateAsync,
    deleteBucket: deleteBucketMutation.mutateAsync,
    refetchBuckets,

    // Helpers
    useBucketStats,
  };
}
