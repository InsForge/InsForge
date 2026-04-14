import { useToast } from '../../../lib/hooks/useToast';

interface UploadToastOptions {
  onCancel?: () => void;
}

export function useUploadToast() {
  const { showToast, updateToast, removeToast } = useToast();

  const showUploadToast = (fileCount: number, options?: UploadToastOptions): string => {
    const message = `${fileCount} file${fileCount > 1 ? 's' : ''} uploading`;
    const toastId = showToast(message, 'upload', undefined, undefined);

    // Set initial progress
    updateToast(toastId, {
      progress: 0,
      onCancel: () => {
        options?.onCancel?.();
        removeToast(toastId);
      },
    });

    return toastId;
  };

  const updateUploadProgress = (toastId: string, progress: number) => {
    updateToast(toastId, { progress });

    // Auto-remove when complete
    if (progress >= 100) {
      setTimeout(() => {
        removeToast(toastId);
      }, 1500); // Show completion state for 1.5s
    }
  };

  const cancelUpload = (toastId: string) => {
    removeToast(toastId);
  };

  return {
    showUploadToast,
    updateUploadProgress,
    cancelUpload,
  };
}
