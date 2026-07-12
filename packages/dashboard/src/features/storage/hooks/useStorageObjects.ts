import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { storageService, type ListObjectsParams } from '#features/storage/services/storage.service';
import { useToast } from '@insforge/ui';

export function useStorageObjects() {
  const { t } = useTranslation('chrome');
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
        const deletedPart = t('storage.filesDeletedPart', {
          count: successCount,
          defaultValue_one: '{{count}} file deleted',
          defaultValue_other: '{{count}} files deleted',
        });
        const failedPart = t('storage.filesFailedToDeletePart', {
          count: failureCount,
          defaultValue_one: '{{count}} file failed to delete',
          defaultValue_other: '{{count}} files failed to delete',
        });
        showToast(
          t('storage.filesDeletedPartially', {
            defaultValue: '{{deletedPart}}, {{failedPart}}.',
            deletedPart,
            failedPart,
          }),
          'warn'
        );
      } else if (failureCount > 0) {
        showToast(
          t('storage.failedToDeleteFiles', {
            count: failureCount,
            defaultValue_one: 'Failed to delete {{count}} file',
            defaultValue_other: 'Failed to delete {{count}} files',
          }),
          'error'
        );
      } else if (successCount > 0) {
        showToast(
          t('storage.filesDeletedSuccessfully', {
            count: successCount,
            defaultValue_one: '{{count}} file deleted successfully.',
            defaultValue_other: '{{count}} files deleted successfully.',
          }),
          'success'
        );
      }

      void queryClient.invalidateQueries({ queryKey: ['storage'] });
    },
    onError: (error: Error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('storage.failedToDeleteFile', { defaultValue: 'Failed to delete file' });
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
