import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storageService, type ListObjectsParams } from '../services/storage.service';
import { useToast } from '../../../lib/hooks/useToast';

export function useStorageObjects() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

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

  return {
    // Loading states
    isUploadingObject: uploadObjectMutation.isPending,
    isDeletingObject: deleteObjectsMutation.isPending,

    // Actions
    uploadObject: uploadObjectMutation.mutateAsync,
    deleteObjects: deleteObjectsMutation.mutate,

    // Helpers
    useListObjects,
    getDownloadUrl: storageService.getDownloadUrl,
    downloadObject: storageService.downloadObject,
  };
}
