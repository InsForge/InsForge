import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService, type ListObjectsParams } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';
import type { StorageBucketSchema } from '@insforge/shared-schemas';

export function useStorageObjects() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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

  const useBucketStats = (buckets: StorageBucketSchema[], enabled = true) => {
    return useQuery({
      queryKey: ['storage', 'bucket-stats', buckets],
      queryFn: async () => {
        const stats: Record<
          string,
          { fileCount: number; totalSize: number; public: boolean; createdAt?: string }
        > = {};
        const promises = buckets.map(async (bucket) => {
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
      enabled: enabled && buckets.length > 0,
      staleTime: 30000,
    });
  };

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

  return {
    useListObjects,
    useBucketStats,
    uploadObject: uploadObjectMutation.mutateAsync,
    deleteObjects: deleteObjectsMutation.mutate,
    isUploadingObject: uploadObjectMutation.isPending,
    isDeletingObject: deleteObjectsMutation.isPending,
    getDownloadUrl: storageService.getDownloadUrl,
    downloadObject: storageService.downloadObject,
  };
}
