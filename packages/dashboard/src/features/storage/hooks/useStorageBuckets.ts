import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useStorageBuckets() {
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
        const stats: Record<
          string,
          { fileCount: number; totalSize: number; public: boolean; createdAt?: string }
        > = {};
        const currentBuckets = buckets || [];
        const promises = currentBuckets.map(async (bucket) => {
          try {
            const result = await storageService.listObjects(bucket.name, { limit: 1000 });
            const objects = result.objects;
            const totalSize = objects.reduce((sum, file) => sum + file.size, 0);
            return {
              bucketName: bucket.name,
              stats: {
                fileCount: result.pagination.total,
                totalSize: totalSize,
                public: bucket.public,
                createdAt: bucket.createdAt,
              },
            };
          } catch (error) {
            if (error) {
              console.error(error);
              return null;
            }
            return {
              bucketName: bucket.name,
              stats: {
                fileCount: 0,
                totalSize: 0,
                public: bucket.public,
                createdAt: bucket.createdAt,
              },
            };
          }
        });
        const results = await Promise.all(promises);
        results.forEach((result) => {
          if (result) {
            stats[result.bucketName] = result.stats;
          }
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to create bucket';
      showToast(errorMessage, 'error');
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete bucket';
      showToast(errorMessage, 'error');
    },
  });

  // Mutation to edit a bucket
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
