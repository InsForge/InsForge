import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService, type ListObjectsParams } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useStorage() {
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

  // Hook to fetch objects in a bucket
  const useListObjects = (
    bucketName: string,
    params?: ListObjectsParams,
    searchQuery?: string,
    enabled = true
  ) => {
    return useQuery({
      queryKey: ['storage', 'objects', bucketName, params?.limit, params?.offset, searchQuery],
      queryFn: () => storageService.listObjects(bucketName, params, searchQuery),
      enabled: enabled && !!bucketName,
      placeholderData: (previousData) => previousData,
    });
  };

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

  // Mutation to upload an object
  const uploadObjectMutation = useMutation({
    mutationFn: async ({
      bucket,
      objectKey,
      file,
    }: {
      bucket: string;
      objectKey: string;
      file: File;
    }) => storageService.uploadObject(bucket, objectKey, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage'] });
    },
  });

  // Mutation to delete an object
  const deleteObjectsMutation = useMutation({
    mutationFn: ({ bucket, keys }: { bucket: string; keys: string[] }) =>
      storageService.deleteObjects(bucket, keys),
    onSuccess: (result) => {
      const { success, failures } = result;
      const successCount = success.length;
      const failureCount = failures.length;
      if (failureCount > 0 && successCount > 0) {
        showToast(
          `${successCount} ${successCount > 1 ? 'files' : 'file'} deleted, ${failureCount} ${failureCount > 1 ? 'files' : 'file'} failed to delete.`,
          'warn'
        );
      } else if (failureCount > 0) {
        showToast(
          `Failed to delete ${failureCount} ${failureCount > 1 ? 'files' : 'file'}`,
          'error'
        );
      } else if (successCount > 0) {
        showToast(
          `${successCount} ${successCount > 1 ? 'files' : 'file'} deleted successfully.`,
          'success'
        );
      }

      void queryClient.invalidateQueries({ queryKey: ['storage'] });
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete file';
      showToast(errorMessage, 'error');
    },
  });

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

  // Mutation to rename an object
  const renameObjectMutation = useMutation({
    mutationFn: ({ bucket, oldKey, newKey }: { bucket: string; oldKey: string; newKey: string }) =>
      storageService.renameObject(bucket, oldKey, newKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['storage'] });
      showToast('File renamed successfully', 'success');
    },
    onError: (error: Error) => {
      const errorMessage = error instanceof Error ? error.message : 'Failed to rename file';
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
    isUploadingObject: uploadObjectMutation.isPending,
    isDeletingObject: deleteObjectsMutation.isPending,
    isCreatingBucket: createBucketMutation.isPending,
    isDeletingBucket: deleteBucketMutation.isPending,
    isEditingBucket: editBucketMutation.isPending,
    isRenamingObject: renameObjectMutation.isPending,

    // Errors
    bucketsError,

    // Actions
    uploadObject: uploadObjectMutation.mutateAsync,
    deleteObjects: deleteObjectsMutation.mutate,
    createBucket: createBucketMutation.mutateAsync,
    deleteBucket: deleteBucketMutation.mutateAsync,
    editBucket: editBucketMutation.mutateAsync,
    renameObject: renameObjectMutation.mutateAsync,
    refetchBuckets,

    // Helpers
    useListObjects,
    useBucketStats,
    getDownloadUrl: storageService.getDownloadUrl,
    downloadObject: storageService.downloadObject,
  };
}
